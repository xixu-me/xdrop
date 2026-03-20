package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/xdrop/monorepo/internal/service"
)

// StartCleanup periodically purges expired or deleted transfers until the context is canceled.
func StartCleanup(ctx context.Context, logger *slog.Logger, interval time.Duration, svc *service.Service) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := svc.CleanupExpired(ctx); err != nil {
				logger.Error("cleanup tick failed", "error", err)
			}
		}
	}
}
