package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	nethttp "net/http"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	apihttp "github.com/xdrop/monorepo/internal/http"
	"github.com/xdrop/monorepo/internal/service"
)

func TestRetryReturnsAfterSuccessfulAttempt(t *testing.T) {
	t.Parallel()

	attempts := 0
	err := retry(context.Background(), 5, 5*time.Millisecond, func() error {
		attempts++
		if attempts < 3 {
			return errors.New("try again")
		}
		return nil
	})

	require.NoError(t, err)
	require.Equal(t, 3, attempts)
}

func TestRetryReturnsContextErrorWhenCancelled(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	done := make(chan struct{})

	go func() {
		time.Sleep(15 * time.Millisecond)
		cancel()
		close(done)
	}()

	err := retry(ctx, 5, 50*time.Millisecond, func() error {
		attempts++
		return errors.New("still failing")
	})

	<-done
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, 1, attempts)
}

func TestRetryReturnsLastErrorAfterExhaustingAttempts(t *testing.T) {
	t.Parallel()

	expected := errors.New("permanent failure")
	attempts := 0

	err := retry(context.Background(), 3, 5*time.Millisecond, func() error {
		attempts++
		return expected
	})

	require.ErrorIs(t, err, expected)
	require.Equal(t, 3, attempts)
}

func TestServerServesHealthzAndShutsDown(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()

	server := &nethttp.Server{
		Addr: listener.Addr().String(),
		Handler: apihttp.NewRouter(
			config.Config{AllowedOrigins: []string{"http://localhost:5173"}},
			slog.New(slog.NewTextHandler(io.Discard, nil)),
			nil,
		),
		ReadHeaderTimeout: 10 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Serve(listener)
	}()

	response, err := nethttp.Get("http://" + listener.Addr().String() + "/healthz")
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, nethttp.StatusOK, response.StatusCode)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	require.NoError(t, server.Shutdown(shutdownCtx))

	err = <-serverErr
	require.ErrorIs(t, err, nethttp.ErrServerClosed)
}

func TestRunCLIReturnsExitCodesAndLogsErrors(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		t.Parallel()

		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		exitCode := runCLI(ctx, cancel, slog.New(slog.NewTextHandler(io.Discard, nil)), appHooks{
			loadConfig: func() (config.Config, error) {
				return config.Config{}, nil
			},
			buildRuntime: func(context.Context, config.Config) (*appRuntime, error) {
				return &appRuntime{close: func() {}}, nil
			},
			newServer: func(config.Config, *slog.Logger, *service.Service) httpServer {
				return newFakeServer()
			},
		})

		require.Equal(t, 0, exitCode)
	})

	t.Run("typed application error", func(t *testing.T) {
		t.Parallel()

		var buffer bytes.Buffer
		exitCode := runCLI(context.Background(), func() {}, newLogger(&buffer), appHooks{
			loadConfig: func() (config.Config, error) {
				return config.Config{}, errors.New("config failed")
			},
		})

		require.Equal(t, 1, exitCode)
		require.Contains(t, buffer.String(), "load config")
	})

	t.Run("generic error", func(t *testing.T) {
		t.Parallel()

		var buffer bytes.Buffer
		exitCode := runCLI(context.Background(), func() {}, newLogger(&buffer), appHooks{
			loadConfig: func() (config.Config, error) {
				return config.Config{}, nil
			},
			buildRuntime: func(context.Context, config.Config) (*appRuntime, error) {
				return nil, errors.New("boom")
			},
		})

		require.Equal(t, 1, exitCode)
		require.Contains(t, buffer.String(), "run api")
	})
}

func TestMainExitsWithRunCLIStatus(t *testing.T) {
	t.Parallel()

	originalNotify := notifySignalContext
	originalRunCLI := runCLIEntrypoint
	originalExit := exitProcess
	defer func() {
		notifySignalContext = originalNotify
		runCLIEntrypoint = originalRunCLI
		exitProcess = originalExit
	}()

	cancelCalled := false
	exitCode := -1

	notifySignalContext = func(
		ctx context.Context,
		_ ...os.Signal,
	) (context.Context, context.CancelFunc) {
		return ctx, func() {
			cancelCalled = true
		}
	}
	runCLIEntrypoint = func(
		ctx context.Context,
		cancel context.CancelFunc,
		logger *slog.Logger,
		hooks appHooks,
	) int {
		require.NotNil(t, ctx)
		require.NotNil(t, logger)
		require.NotNil(t, hooks.loadConfig)
		cancel()
		return 7
	}
	exitProcess = func(code int) {
		exitCode = code
	}

	main()

	require.True(t, cancelCalled)
	require.Equal(t, 7, exitCode)
}
