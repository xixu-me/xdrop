package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	nethttp "net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/service"
	"github.com/xdrop/monorepo/internal/storage"
)

func TestRunMainHandlesLoadConfigErrors(t *testing.T) {
	t.Parallel()

	err := runMain(context.Background(), func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)), appHooks{
		loadConfig: func() (config.Config, error) {
			return config.Config{}, errors.New("broken config")
		},
		buildRuntime: func(context.Context, config.Config) (*appRuntime, error) {
			t.Fatal("buildRuntime should not be called")
			return nil, nil
		},
	})

	require.ErrorContains(t, err, "load config")
}

func TestRunMainBuildsRuntimeRunsServerAndClosesRuntime(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	cfg := config.Config{Addr: ":8080"}
	server := newFakeServer()
	closed := false
	cleanupStarted := make(chan struct{}, 1)

	err := runMain(ctx, cancel, slog.New(slog.NewTextHandler(io.Discard, nil)), appHooks{
		loadConfig: func() (config.Config, error) {
			return cfg, nil
		},
		buildRuntime: func(context.Context, config.Config) (*appRuntime, error) {
			return &appRuntime{
				service: nil,
				close: func() {
					closed = true
				},
			}, nil
		},
		newServer: func(config.Config, *slog.Logger, *service.Service) httpServer {
			return server
		},
		startCleanup: func(context.Context, *slog.Logger, time.Duration, *service.Service) {
			cleanupStarted <- struct{}{}
		},
	})

	require.NoError(t, err)
	require.True(t, closed)
	require.True(t, server.shutdownCalled)
	select {
	case <-cleanupStarted:
	case <-time.After(time.Second):
		t.Fatal("expected cleanup loop to start")
	}
}

func TestDefaultHooksAndHelpers(t *testing.T) {
	t.Parallel()

	t.Run("app error unwrap", func(t *testing.T) {
		t.Parallel()

		cause := errors.New("root cause")
		err := &appError{message: "outer", err: cause}
		require.ErrorIs(t, err, cause)
	})

	t.Run("default hooks are wired", func(t *testing.T) {
		t.Parallel()

		builder := defaultBuildHooks()
		require.NotNil(t, builder.openDB)
		require.NotNil(t, builder.waitForDB)
		require.NotNil(t, builder.runMigrations)
		require.NotNil(t, builder.openStorage)
		require.NotNil(t, builder.openRedis)
		require.NotNil(t, builder.newLimiter)
		require.NotNil(t, builder.newRepository)

		hooks := defaultAppHooks()
		require.NotNil(t, hooks.loadConfig)
		require.NotNil(t, hooks.buildRuntime)
		require.NotNil(t, hooks.newServer)
		require.NotNil(t, hooks.startCleanup)

		require.NoError(t, waitForPostgres(context.Background(), &fakeDB{}))
		require.ErrorContains(t, runPostgresMigrations(context.Background(), &fakeDB{}), "unexpected db handle type")

		pool, err := pgxpool.New(context.Background(), "postgres://xdrop:xdrop@127.0.0.1:1/xdrop?sslmode=disable&connect_timeout=1")
		require.NoError(t, err)
		t.Cleanup(pool.Close)
		require.Error(t, runPostgresMigrations(context.Background(), &pgxPoolHandle{Pool: pool}))

		store, err := openObjectStorage(context.Background(), config.Config{
			S3Endpoint:       "http://localhost:9000",
			S3PublicEndpoint: "http://localhost:9000",
			S3Region:         "us-east-1",
			S3Bucket:         "xdrop",
			S3AccessKey:      "minioadmin",
			S3SecretKey:      "minioadmin",
		})
		require.NoError(t, err)
		require.NotNil(t, store)

		redisClient := openRedisClient(config.Config{RedisAddr: "localhost:6379"})
		require.NotNil(t, redisClient)
		require.NotNil(t, newRedisLimiter(redisClient))
		require.Nil(t, newRedisLimiter(&fakeRedis{}))

		require.NotNil(t, newPostgresRepository(&pgxPoolHandle{}))
		require.Nil(t, newPostgresRepository(&fakeDB{}))

		db, err := openPostgresDB(context.Background(), "postgres://xdrop:xdrop@localhost:5432/xdrop?sslmode=disable")
		require.NoError(t, err)
		db.Close()

		_, err = buildDefaultRuntime(context.Background(), config.Config{DatabaseURL: "postgres://%zz"})
		require.Error(t, err)
	})

	t.Run("logger and server helpers", func(t *testing.T) {
		t.Parallel()

		logger := newLogger(io.Discard)
		require.NotNil(t, logger)

		server := newHTTPServer(config.Config{Addr: ":8080"}, logger, nil)
		httpServer, ok := server.(*nethttp.Server)
		require.True(t, ok)
		require.Equal(t, ":8080", httpServer.Addr)
		require.Equal(t, 10*time.Second, httpServer.ReadHeaderTimeout)
		require.NotNil(t, httpServer.Handler)
	})
}

func TestBuildRuntimeHandlesFailuresAndSuccess(t *testing.T) {
	t.Parallel()

	baseConfig := config.Config{
		DatabaseURL: "postgres://example.test/xdrop",
	}

	t.Run("connect postgres failure", func(t *testing.T) {
		t.Parallel()

		_, err := buildRuntime(context.Background(), baseConfig, buildHooks{
			openDB: func(context.Context, string) (dbHandle, error) {
				return nil, errors.New("dial failed")
			},
		})
		require.ErrorContains(t, err, "connect postgres")
	})

	t.Run("ping failure closes database", func(t *testing.T) {
		t.Parallel()

		db := &fakeDB{pingErr: errors.New("ping failed")}
		_, err := buildRuntime(context.Background(), baseConfig, buildHooks{
			openDB: func(context.Context, string) (dbHandle, error) {
				return db, nil
			},
			waitForDB: func(context.Context, dbHandle) error {
				return db.Ping(context.Background())
			},
		})
		require.ErrorContains(t, err, "ping postgres")
		require.True(t, db.closed)
	})

	t.Run("migration and storage failures close database", func(t *testing.T) {
		t.Parallel()

		t.Run("migration", func(t *testing.T) {
			db := &fakeDB{}
			_, err := buildRuntime(context.Background(), baseConfig, buildHooks{
				openDB: func(context.Context, string) (dbHandle, error) {
					return db, nil
				},
				waitForDB: func(context.Context, dbHandle) error {
					return nil
				},
				runMigrations: func(context.Context, dbHandle) error {
					return errors.New("migration failed")
				},
			})
			require.ErrorContains(t, err, "run migrations")
			require.True(t, db.closed)
		})

		t.Run("ensure bucket", func(t *testing.T) {
			db := &fakeDB{}
			store := &fakeObjectStorage{ensureBucketErr: errors.New("bucket failed")}
			_, err := buildRuntime(context.Background(), baseConfig, buildHooks{
				openDB: func(context.Context, string) (dbHandle, error) {
					return db, nil
				},
				waitForDB: func(context.Context, dbHandle) error {
					return nil
				},
				runMigrations: func(context.Context, dbHandle) error {
					return nil
				},
				openStorage: func(context.Context, config.Config) (storage.ObjectStorage, error) {
					return store, nil
				},
			})
			require.ErrorContains(t, err, "ensure bucket")
			require.True(t, db.closed)
			require.True(t, store.ensureBucketCalled)
		})

		t.Run("open storage", func(t *testing.T) {
			db := &fakeDB{}
			_, err := buildRuntime(context.Background(), baseConfig, buildHooks{
				openDB: func(context.Context, string) (dbHandle, error) {
					return db, nil
				},
				waitForDB: func(context.Context, dbHandle) error {
					return nil
				},
				runMigrations: func(context.Context, dbHandle) error {
					return nil
				},
				openStorage: func(context.Context, config.Config) (storage.ObjectStorage, error) {
					return nil, errors.New("storage failed")
				},
			})
			require.ErrorContains(t, err, "init object storage")
			require.True(t, db.closed)
		})
	})

	t.Run("nil waitForDB falls back to Ping", func(t *testing.T) {
		t.Parallel()

		db := &fakeDB{}
		redisClient := &fakeRedis{}
		store := &fakeObjectStorage{}

		runtime, err := buildRuntime(context.Background(), baseConfig, buildHooks{
			openDB: func(context.Context, string) (dbHandle, error) {
				return db, nil
			},
			runMigrations: func(context.Context, dbHandle) error {
				return nil
			},
			openStorage: func(context.Context, config.Config) (storage.ObjectStorage, error) {
				return store, nil
			},
			openRedis: func(config.Config) redisHandle {
				return redisClient
			},
			newLimiter: func(redisHandle) ratelimit.Limiter {
				return nil
			},
			newRepository: func(dbHandle) repo.Repository {
				return nil
			},
		})
		require.NoError(t, err)
		require.Equal(t, 1, db.pingCalls)

		runtime.close()
	})

	t.Run("success closes redis and database", func(t *testing.T) {
		t.Parallel()

		db := &fakeDB{}
		redisClient := &fakeRedis{}
		store := &fakeObjectStorage{}

		runtime, err := buildRuntime(context.Background(), baseConfig, buildHooks{
			openDB: func(context.Context, string) (dbHandle, error) {
				return db, nil
			},
			waitForDB: func(context.Context, dbHandle) error {
				return nil
			},
			runMigrations: func(context.Context, dbHandle) error {
				return nil
			},
			openStorage: func(context.Context, config.Config) (storage.ObjectStorage, error) {
				return store, nil
			},
			openRedis: func(config.Config) redisHandle {
				return redisClient
			},
			newLimiter: func(redisHandle) ratelimit.Limiter {
				return nil
			},
			newRepository: func(dbHandle) repo.Repository {
				return nil
			},
		})
		require.NoError(t, err)
		require.NotNil(t, runtime)
		require.True(t, store.ensureBucketCalled)
		require.False(t, db.closed)
		require.False(t, redisClient.closed)

		runtime.close()
		require.True(t, db.closed)
		require.True(t, redisClient.closed)
	})
}

func TestRunServerStartsCleanupAndShutsDownOnCancel(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	server := newFakeServer()
	cleanupStarted := make(chan struct{}, 1)
	done := make(chan struct{})

	go func() {
		runServer(
			ctx,
			cancel,
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			config.Config{Addr: ":8080", CleanupInterval: time.Second},
			nil,
			func(config.Config, *slog.Logger, *service.Service) httpServer { return server },
			func(context.Context, *slog.Logger, time.Duration, *service.Service) { cleanupStarted <- struct{}{} },
		)
		close(done)
	}()

	<-server.listenStarted
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runServer did not return after cancellation")
	}

	require.True(t, server.shutdownCalled)
	select {
	case <-cleanupStarted:
	case <-time.After(time.Second):
		t.Fatal("expected cleanup loop to start")
	}
}

func TestRunServerCancelsContextWhenListenFails(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	server := &fakeServer{listenErr: errors.New("bind failed"), listenStarted: make(chan struct{})}
	done := make(chan struct{})

	go func() {
		runServer(
			ctx,
			cancel,
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			config.Config{Addr: ":8080"},
			nil,
			func(config.Config, *slog.Logger, *service.Service) httpServer { return server },
			nil,
		)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runServer did not return after listen failure")
	}

	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.True(t, server.shutdownCalled)
}

func TestRunServerContinuesAfterShutdownError(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	server := newFakeServer()
	server.shutdownErr = errors.New("shutdown failed")
	done := make(chan struct{})

	go func() {
		runServer(
			ctx,
			cancel,
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			config.Config{Addr: ":8080"},
			nil,
			func(config.Config, *slog.Logger, *service.Service) httpServer { return server },
			nil,
		)
		close(done)
	}()

	<-server.listenStarted
	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runServer did not return after shutdown failure")
	}

	require.True(t, server.shutdownCalled)
}

type fakeDB struct {
	pingErr   error
	pingCalls int
	closed    bool
}

func (d *fakeDB) Ping(context.Context) error {
	d.pingCalls++
	return d.pingErr
}

func (d *fakeDB) Close() {
	d.closed = true
}

type fakeRedis struct {
	closed bool
}

func (r *fakeRedis) Close() error {
	r.closed = true
	return nil
}

type fakeObjectStorage struct {
	ensureBucketErr    error
	ensureBucketCalled bool
}

func (s *fakeObjectStorage) PresignUpload(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

func (s *fakeObjectStorage) PresignDownload(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

func (s *fakeObjectStorage) PutObject(context.Context, string, []byte, string) error {
	return nil
}

func (s *fakeObjectStorage) DeletePrefix(context.Context, string) error {
	return nil
}

func (s *fakeObjectStorage) EnsureBucket(context.Context) error {
	s.ensureBucketCalled = true
	return s.ensureBucketErr
}

type fakeServer struct {
	listenErr      error
	shutdownErr    error
	shutdownCalled bool
	listenStarted  chan struct{}
	stop           chan struct{}
	stopClosed     bool
}

func newFakeServer() *fakeServer {
	return &fakeServer{
		listenStarted: make(chan struct{}),
		stop:          make(chan struct{}),
	}
}

func (s *fakeServer) ListenAndServe() error {
	if s.listenStarted != nil {
		close(s.listenStarted)
		s.listenStarted = nil
	}
	if s.listenErr != nil {
		return s.listenErr
	}
	<-s.stop
	return nethttp.ErrServerClosed
}

func (s *fakeServer) Shutdown(context.Context) error {
	s.shutdownCalled = true
	if s.stop != nil && !s.stopClosed {
		close(s.stop)
		s.stopClosed = true
	}
	return s.shutdownErr
}
