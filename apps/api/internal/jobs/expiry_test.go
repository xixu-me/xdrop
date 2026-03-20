package jobs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/models"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/service"
)

func TestStartCleanupPurgesExpiredTransfersOnTick(t *testing.T) {
	t.Parallel()

	cleanupRepo := &cleanupRepository{
		transfer: models.Transfer{
			ID:        "expired-transfer",
			Status:    models.TransferStatusReady,
			ExpiresAt: time.Now().UTC().Add(-time.Hour),
		},
		purged: make(chan struct{}),
	}
	objectStorage := &cleanupStorage{deletedPrefixes: make(chan string, 1)}
	svc := service.New(config.Config{}, cleanupRepo, objectStorage, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		StartCleanup(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), 10*time.Millisecond, svc)
		close(done)
	}()

	select {
	case prefix := <-objectStorage.deletedPrefixes:
		require.Equal(t, "transfers/expired-transfer/", prefix)
	case <-time.After(time.Second):
		t.Fatal("cleanup job did not delete expired transfer objects")
	}

	select {
	case <-cleanupRepo.purged:
	case <-time.After(time.Second):
		t.Fatal("cleanup job did not mark transfer as purged")
	}

	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup job did not stop after cancellation")
	}
}

func TestStartCleanupStopsWhenContextIsCancelled(t *testing.T) {
	t.Parallel()

	svc := service.New(config.Config{}, &cleanupRepository{purged: make(chan struct{})}, &cleanupStorage{
		deletedPrefixes: make(chan string, 1),
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		StartCleanup(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), time.Hour, svc)
		close(done)
	}()

	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup job did not exit after cancellation")
	}
}

func TestStartCleanupLogsCleanupErrors(t *testing.T) {
	t.Parallel()

	var buffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buffer, nil))
	svc := service.New(config.Config{}, &cleanupRepository{
		listErr: errors.New("cleanup failed"),
		purged:  make(chan struct{}),
	}, &cleanupStorage{
		deletedPrefixes: make(chan string, 1),
	}, nil)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		StartCleanup(ctx, logger, 10*time.Millisecond, svc)
		close(done)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(buffer.String(), "cleanup tick failed")
	}, time.Second, 10*time.Millisecond)

	cancel()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup job did not stop after logging an error")
	}
}

type cleanupRepository struct {
	mu       sync.Mutex
	listErr  error
	transfer models.Transfer
	purged   chan struct{}
	once     sync.Once
}

func (r *cleanupRepository) CreateTransfer(context.Context, models.Transfer) error {
	return nil
}

func (r *cleanupRepository) GetTransfer(context.Context, string) (models.Transfer, error) {
	return models.Transfer{}, repo.ErrNotFound
}

func (r *cleanupRepository) RegisterFiles(context.Context, string, []models.TransferFile) error {
	return nil
}

func (r *cleanupRepository) ListFiles(context.Context, string) ([]models.TransferFile, error) {
	return nil, nil
}

func (r *cleanupRepository) CompleteChunks(context.Context, string, []models.TransferChunk) error {
	return nil
}

func (r *cleanupRepository) GetResumeState(context.Context, string) (models.TransferResumeState, error) {
	return models.TransferResumeState{}, nil
}

func (r *cleanupRepository) SetManifest(context.Context, string, string, int64) error {
	return nil
}

func (r *cleanupRepository) FinalizeTransfer(context.Context, string, string, int, int64) error {
	return nil
}

func (r *cleanupRepository) UpdateTransfer(context.Context, string, models.UpdateTransferParams) error {
	return nil
}

func (r *cleanupRepository) MarkDeleted(context.Context, string) error {
	return nil
}

func (r *cleanupRepository) ListCleanupCandidates(context.Context, int) ([]models.Transfer, error) {
	if r.listErr != nil {
		return nil, r.listErr
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.transfer.ID == "" || r.transfer.PurgedAt != nil {
		return nil, nil
	}

	return []models.Transfer{r.transfer}, nil
}

func (r *cleanupRepository) MarkPurged(context.Context, string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now().UTC()
	r.transfer.PurgedAt = &now
	r.transfer.Status = models.TransferStatusExpired
	r.once.Do(func() {
		close(r.purged)
	})
	return nil
}

type cleanupStorage struct {
	deletedPrefixes chan string
}

func (s *cleanupStorage) PresignUpload(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

func (s *cleanupStorage) PresignDownload(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

func (s *cleanupStorage) PutObject(context.Context, string, []byte, string) error {
	return nil
}

func (s *cleanupStorage) DeletePrefix(_ context.Context, prefix string) error {
	select {
	case s.deletedPrefixes <- prefix:
	default:
	}
	return nil
}

func (s *cleanupStorage) EnsureBucket(context.Context) error {
	return nil
}
