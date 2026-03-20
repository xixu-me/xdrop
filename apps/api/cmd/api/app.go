package main

import (
	"context"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/xdrop/monorepo/internal/config"
	apihttp "github.com/xdrop/monorepo/internal/http"
	"github.com/xdrop/monorepo/internal/jobs"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/service"
	"github.com/xdrop/monorepo/internal/storage"
)

type appError struct {
	message string
	err     error
}

func (e *appError) Error() string {
	return fmt.Sprintf("%s: %v", e.message, e.err)
}

func (e *appError) Unwrap() error {
	return e.err
}

type dbHandle interface {
	Ping(context.Context) error
	Close()
}

// redisHandle captures the small subset of Redis client behavior the runtime needs.
type redisHandle interface {
	Close() error
}

// httpServer abstracts the concrete HTTP server so tests can replace network IO.
type httpServer interface {
	ListenAndServe() error
	Shutdown(context.Context) error
}

// appRuntime groups the constructed service graph and its coordinated cleanup.
type appRuntime struct {
	service *service.Service
	close   func()
}

// buildHooks packages side-effecting dependencies for runtime construction tests.
type buildHooks struct {
	openDB        func(context.Context, string) (dbHandle, error)
	waitForDB     func(context.Context, dbHandle) error
	runMigrations func(context.Context, dbHandle) error
	openStorage   func(context.Context, config.Config) (storage.ObjectStorage, error)
	openRedis     func(config.Config) redisHandle
	newLimiter    func(redisHandle) ratelimit.Limiter
	newRepository func(dbHandle) repo.Repository
}

// appHooks packages top-level startup steps for CLI tests.
type appHooks struct {
	loadConfig   func() (config.Config, error)
	buildRuntime func(context.Context, config.Config) (*appRuntime, error)
	newServer    func(config.Config, *slog.Logger, *service.Service) httpServer
	startCleanup func(context.Context, *slog.Logger, time.Duration, *service.Service)
}

type pgxPoolHandle struct {
	*pgxpool.Pool
}

type redisClientHandle struct {
	*redis.Client
}

// defaultBuildHooks returns the production dependency graph for runtime construction.
func defaultBuildHooks() buildHooks {
	return buildHooks{
		openDB:        openPostgresDB,
		waitForDB:     waitForPostgres,
		runMigrations: runPostgresMigrations,
		openStorage:   openObjectStorage,
		openRedis:     openRedisClient,
		newLimiter:    newRedisLimiter,
		newRepository: newPostgresRepository,
	}
}

// defaultAppHooks returns the production wiring used by the CLI entrypoint.
func defaultAppHooks() appHooks {
	return appHooks{
		loadConfig:   config.Load,
		buildRuntime: buildDefaultRuntime,
		newServer:    newHTTPServer,
		startCleanup: jobs.StartCleanup,
	}
}

// buildDefaultRuntime builds the production service graph with the default dependency set.
func buildDefaultRuntime(ctx context.Context, cfg config.Config) (*appRuntime, error) {
	return buildRuntime(ctx, cfg, defaultBuildHooks())
}

func openPostgresDB(ctx context.Context, databaseURL string) (dbHandle, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &pgxPoolHandle{Pool: pool}, nil
}

func waitForPostgres(ctx context.Context, db dbHandle) error {
	return retry(ctx, 30, 2*time.Second, func() error {
		return db.Ping(ctx)
	})
}

func runPostgresMigrations(ctx context.Context, db dbHandle) error {
	handle, ok := db.(*pgxPoolHandle)
	if !ok {
		return fmt.Errorf("unexpected db handle type %T", db)
	}
	return repo.RunMigrations(ctx, handle.Pool)
}

func openObjectStorage(ctx context.Context, cfg config.Config) (storage.ObjectStorage, error) {
	return storage.NewS3Storage(ctx, storage.Config{
		Endpoint:       cfg.S3Endpoint,
		PublicEndpoint: cfg.S3PublicEndpoint,
		Region:         cfg.S3Region,
		Bucket:         cfg.S3Bucket,
		AccessKey:      cfg.S3AccessKey,
		SecretKey:      cfg.S3SecretKey,
		UseSSL:         cfg.S3UseSSL,
	})
}

func openRedisClient(cfg config.Config) redisHandle {
	return &redisClientHandle{Client: redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})}
}

func newRedisLimiter(client redisHandle) ratelimit.Limiter {
	handle, ok := client.(*redisClientHandle)
	if !ok {
		return nil
	}
	return ratelimit.NewRedisLimiter(handle.Client)
}

func newPostgresRepository(db dbHandle) repo.Repository {
	handle, ok := db.(*pgxPoolHandle)
	if !ok {
		return nil
	}
	return repo.NewPostgresRepository(handle.Pool)
}

// buildRuntime connects the database, storage, rate limiter, and service layer.
func buildRuntime(ctx context.Context, cfg config.Config, hooks buildHooks) (*appRuntime, error) {
	db, err := hooks.openDB(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, &appError{message: "connect postgres", err: err}
	}

	closeDB := true
	defer func() {
		if closeDB {
			db.Close()
		}
	}()

	waitForDB := hooks.waitForDB
	if waitForDB == nil {
		waitForDB = func(ctx context.Context, db dbHandle) error {
			return db.Ping(ctx)
		}
	}

	if err := waitForDB(ctx, db); err != nil {
		return nil, &appError{message: "ping postgres", err: err}
	}

	if err := hooks.runMigrations(ctx, db); err != nil {
		return nil, &appError{message: "run migrations", err: err}
	}

	objectStorage, err := hooks.openStorage(ctx, cfg)
	if err != nil {
		return nil, &appError{message: "init object storage", err: err}
	}
	if err := objectStorage.EnsureBucket(ctx); err != nil {
		return nil, &appError{message: "ensure bucket", err: err}
	}

	redisClient := hooks.openRedis(cfg)
	closeDB = false

	return &appRuntime{
		service: service.New(cfg, hooks.newRepository(db), objectStorage, hooks.newLimiter(redisClient)),
		close: func() {
			_ = redisClient.Close()
			db.Close()
		},
	}, nil
}

// runMain loads configuration, builds the runtime, and blocks until the server stops.
func runMain(ctx context.Context, cancel context.CancelFunc, logger *slog.Logger, hooks appHooks) error {
	cfg, err := hooks.loadConfig()
	if err != nil {
		return &appError{message: "load config", err: err}
	}

	runtime, err := hooks.buildRuntime(ctx, cfg)
	if err != nil {
		return err
	}
	defer runtime.close()

	runServer(ctx, cancel, logger, cfg, runtime.service, hooks.newServer, hooks.startCleanup)
	return nil
}

// runServer starts background cleanup, serves HTTP traffic, and shuts down gracefully.
func runServer(
	ctx context.Context,
	cancel context.CancelFunc,
	logger *slog.Logger,
	cfg config.Config,
	svc *service.Service,
	newServer func(config.Config, *slog.Logger, *service.Service) httpServer,
	startCleanup func(context.Context, *slog.Logger, time.Duration, *service.Service),
) {
	if startCleanup != nil {
		go startCleanup(ctx, logger, cfg.CleanupInterval, svc)
	}

	server := newServer(cfg, logger, svc)
	serverDone := make(chan error, 1)

	go func() {
		logger.Info("api listening", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && err != nethttp.ErrServerClosed {
			logger.Error("listen failed", "error", err)
			cancel()
			serverDone <- err
			return
		}

		serverDone <- nil
	}()

	<-ctx.Done()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown failed", "error", err)
	}

	<-serverDone
}

// newHTTPServer constructs the concrete net/http server used in production.
func newHTTPServer(cfg config.Config, logger *slog.Logger, svc *service.Service) httpServer {
	return &nethttp.Server{
		Addr:              cfg.Addr,
		Handler:           apihttp.NewRouter(cfg, logger, svc),
		ReadHeaderTimeout: 10 * time.Second,
	}
}

// retry keeps polling a dependency until it succeeds, the context is canceled, or attempts run out.
func retry(ctx context.Context, attempts int, delay time.Duration, fn func() error) error {
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}

	return lastErr
}
