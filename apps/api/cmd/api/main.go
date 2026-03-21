package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

var (
	// These indirections keep process-level side effects swappable in tests.
	notifySignalContext = signal.NotifyContext
	runCLIEntrypoint    = runCLI
	exitProcess         = os.Exit
)

func main() {
	ctx, cancel := notifySignalContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	exitProcess(runCLIEntrypoint(ctx, cancel, newLogger(os.Stdout), defaultAppHooks()))
}

// runCLI executes the fully wired application and converts failures into an exit code.
func runCLI(ctx context.Context, cancel context.CancelFunc, logger *slog.Logger, hooks appHooks) int {
	if err := runMain(ctx, cancel, logger, hooks); err != nil {
		var typedErr *appError
		if errors.As(err, &typedErr) {
			logger.Error(typedErr.message, "error", typedErr.err)
		} else {
			logger.Error("run api", "error", err)
		}
		return 1
	}

	return 0
}

// newLogger writes structured JSON logs so local and container output share one format.
func newLogger(writer io.Writer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(writer, &slog.HandlerOptions{Level: slog.LevelInfo}))
}
