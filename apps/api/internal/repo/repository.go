package repo

import (
	"context"

	"github.com/xdrop/monorepo/internal/models"
)

// Repository defines the persistence contract for transfer lifecycle operations.
type Repository interface {
	CreateTransfer(ctx context.Context, transfer models.Transfer) error
	GetTransfer(ctx context.Context, transferID string) (models.Transfer, error)
	RegisterFiles(ctx context.Context, transferID string, files []models.TransferFile) error
	ListFiles(ctx context.Context, transferID string) ([]models.TransferFile, error)
	CompleteChunks(ctx context.Context, transferID string, chunks []models.TransferChunk) error
	GetResumeState(ctx context.Context, transferID string) (models.TransferResumeState, error)
	SetManifest(ctx context.Context, transferID string, objectKey string, ciphertextSize int64) error
	FinalizeTransfer(ctx context.Context, transferID string, wrappedRootKey string, totalFiles int, totalCiphertextBytes int64) error
	UpdateTransfer(ctx context.Context, transferID string, params models.UpdateTransferParams) error
	MarkDeleted(ctx context.Context, transferID string) error
	ListCleanupCandidates(ctx context.Context, limit int) ([]models.Transfer, error)
	MarkPurged(ctx context.Context, transferID string) error
}
