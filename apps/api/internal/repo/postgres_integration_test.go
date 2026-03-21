package repo

import (
	"context"
	"os/exec"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/xdrop/monorepo/internal/models"
)

func TestRunMigrationsAndRepositoryLifecycle(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	db := startPostgresTestDB(t, ctx)
	require.NoError(t, RunMigrations(ctx, db))
	require.NoError(t, RunMigrations(ctx, db))

	repository := NewPostgresRepository(db)

	_, err := repository.GetTransfer(ctx, "missing-transfer")
	require.ErrorIs(t, err, ErrNotFound)

	now := time.Now().UTC().Truncate(time.Second)
	transfer := models.Transfer{
		ID:              "transfer-1",
		Status:          models.TransferStatusDraft,
		ExpiresAt:       now.Add(time.Hour),
		CreatedAt:       now,
		UpdatedAt:       now,
		ManageTokenHash: "hash-1",
	}
	require.NoError(t, repository.CreateTransfer(ctx, transfer))

	files := []models.TransferFile{
		{
			TransferID:      transfer.ID,
			OpaqueFileID:    "file-a",
			TotalChunks:     2,
			CiphertextBytes: 64,
			PlaintextBytes:  int64ptr(32),
			ChunkSize:       32,
		},
		{
			TransferID:      transfer.ID,
			OpaqueFileID:    "file-b",
			TotalChunks:     1,
			CiphertextBytes: 48,
			PlaintextBytes:  int64ptr(24),
			ChunkSize:       48,
		},
	}
	require.NoError(t, repository.RegisterFiles(ctx, transfer.ID, files))

	stored, err := repository.GetTransfer(ctx, transfer.ID)
	require.NoError(t, err)
	require.Equal(t, models.TransferStatusUploading, stored.Status)

	listedFiles, err := repository.ListFiles(ctx, transfer.ID)
	require.NoError(t, err)
	require.Len(t, listedFiles, 2)
	require.Equal(t, "file-a", listedFiles[0].OpaqueFileID)
	require.Equal(t, "pending", listedFiles[0].UploadStatus)
	require.Equal(t, "file-b", listedFiles[1].OpaqueFileID)

	require.NoError(t, repository.CompleteChunks(ctx, transfer.ID, []models.TransferChunk{
		{
			TransferID:     transfer.ID,
			OpaqueFileID:   "file-a",
			ChunkIndex:     0,
			ObjectKey:      "transfers/transfer-1/files/file-a/chunks/00000000.bin",
			CiphertextSize: 32,
			ChecksumSHA256: "checksum-a0",
		},
		{
			TransferID:     transfer.ID,
			OpaqueFileID:   "file-a",
			ChunkIndex:     0,
			ObjectKey:      "transfers/transfer-1/files/file-a/chunks/00000000.bin",
			CiphertextSize: 32,
			ChecksumSHA256: "checksum-a0-updated",
		},
		{
			TransferID:     transfer.ID,
			OpaqueFileID:   "file-b",
			ChunkIndex:     0,
			ObjectKey:      "transfers/transfer-1/files/file-b/chunks/00000000.bin",
			CiphertextSize: 48,
			ChecksumSHA256: "checksum-b0",
		},
	}))

	resume, err := repository.GetResumeState(ctx, transfer.ID)
	require.NoError(t, err)
	require.Equal(t, []int{0}, resume.UploadedChunks["file-a"])
	require.Equal(t, []int{0}, resume.UploadedChunks["file-b"])

	listedFiles, err = repository.ListFiles(ctx, transfer.ID)
	require.NoError(t, err)
	require.Equal(t, "pending", listedFiles[0].UploadStatus)
	require.Equal(t, "complete", listedFiles[1].UploadStatus)

	require.NoError(t, repository.CompleteChunks(ctx, transfer.ID, []models.TransferChunk{
		{
			TransferID:     transfer.ID,
			OpaqueFileID:   "file-a",
			ChunkIndex:     1,
			ObjectKey:      "transfers/transfer-1/files/file-a/chunks/00000001.bin",
			CiphertextSize: 32,
			ChecksumSHA256: "checksum-a1",
		},
	}))
	require.NoError(t, repository.SetManifest(ctx, transfer.ID, "transfers/transfer-1/manifest.bin", 77))
	require.NoError(t, repository.FinalizeTransfer(ctx, transfer.ID, `{"version":1}`, 2, 112))

	finalized, err := repository.GetTransfer(ctx, transfer.ID)
	require.NoError(t, err)
	require.Equal(t, models.TransferStatusReady, finalized.Status)
	require.Equal(t, "transfers/transfer-1/manifest.bin", finalized.ManifestObjectKey)
	require.Equal(t, `{"version":1}`, finalized.WrappedRootKey)
	require.Equal(t, 2, finalized.TotalFiles)
	require.Equal(t, int64(112), finalized.TotalCiphertextBytes)
	require.NotNil(t, finalized.FinalizedAt)

	newExpiry := now.Add(3 * time.Hour)
	newManifestKey := "transfers/transfer-1/manifest-renamed.bin"
	newManifestSize := int64(99)
	require.NoError(t, repository.UpdateTransfer(ctx, transfer.ID, models.UpdateTransferParams{
		ExpiresAt:              &newExpiry,
		ManifestObjectKey:      &newManifestKey,
		ManifestCiphertextSize: &newManifestSize,
	}))

	updated, err := repository.GetTransfer(ctx, transfer.ID)
	require.NoError(t, err)
	require.WithinDuration(t, newExpiry, updated.ExpiresAt, time.Second)
	require.Equal(t, newManifestKey, updated.ManifestObjectKey)
	require.Equal(t, newManifestSize, updated.ManifestCiphertextSize)
}

func TestPostgresRepositoryFinalizeTransferValidatesManifestAndUploads(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	db := startPostgresTestDB(t, ctx)
	require.NoError(t, RunMigrations(ctx, db))

	repository := NewPostgresRepository(db)
	transfer := createTestTransfer("transfer-guard", models.TransferStatusDraft, time.Now().UTC().Add(time.Hour))
	require.NoError(t, repository.CreateTransfer(ctx, transfer))
	require.NoError(t, repository.RegisterFiles(ctx, transfer.ID, []models.TransferFile{{
		TransferID:      transfer.ID,
		OpaqueFileID:    "file-a",
		TotalChunks:     1,
		CiphertextBytes: 16,
		ChunkSize:       16,
	}}))

	err := repository.FinalizeTransfer(ctx, transfer.ID, `{"version":1}`, 1, 16)
	require.ErrorContains(t, err, "manifest not registered")

	require.NoError(t, repository.SetManifest(ctx, transfer.ID, "transfers/transfer-guard/manifest.bin", 32))
	err = repository.FinalizeTransfer(ctx, transfer.ID, `{"version":1}`, 1, 16)
	require.ErrorContains(t, err, "upload incomplete")
}

func TestPostgresRepositoryCleanupCandidatesAndPurging(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	db := startPostgresTestDB(t, ctx)
	require.NoError(t, RunMigrations(ctx, db))

	repository := NewPostgresRepository(db)
	now := time.Now().UTC()

	expiredReady := createTestTransfer("expired-ready", models.TransferStatusReady, now.Add(-time.Hour))
	deletedTransfer := createTestTransfer("deleted-transfer", models.TransferStatusReady, now.Add(time.Hour))
	futureTransfer := createTestTransfer("future-transfer", models.TransferStatusUploading, now.Add(time.Hour))
	purgedTransfer := createTestTransfer("purged-transfer", models.TransferStatusReady, now.Add(-2*time.Hour))

	for _, transfer := range []models.Transfer{expiredReady, deletedTransfer, futureTransfer, purgedTransfer} {
		require.NoError(t, repository.CreateTransfer(ctx, transfer))
	}
	require.NoError(t, repository.MarkDeleted(ctx, deletedTransfer.ID))
	require.NoError(t, repository.MarkPurged(ctx, purgedTransfer.ID))

	candidates, err := repository.ListCleanupCandidates(ctx, 10)
	require.NoError(t, err)

	candidateByID := map[string]models.Transfer{}
	for _, candidate := range candidates {
		candidateByID[candidate.ID] = candidate
	}

	require.Contains(t, candidateByID, expiredReady.ID)
	require.Contains(t, candidateByID, deletedTransfer.ID)
	require.NotContains(t, candidateByID, futureTransfer.ID)
	require.NotContains(t, candidateByID, purgedTransfer.ID)
	require.Equal(t, models.TransferStatusExpired, candidateByID[expiredReady.ID].Status)
	require.Equal(t, models.TransferStatusDeleted, candidateByID[deletedTransfer.ID].Status)

	require.NoError(t, repository.MarkPurged(ctx, expiredReady.ID))
	purged, err := repository.GetTransfer(ctx, expiredReady.ID)
	require.NoError(t, err)
	require.Equal(t, models.TransferStatusExpired, purged.Status)
	require.NotNil(t, purged.PurgedAt)
}

func startPostgresTestDB(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()

	container, err := tcpostgres.Run(
		ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("xdrop"),
		tcpostgres.WithUsername("xdrop"),
		tcpostgres.WithPassword("xdrop"),
		tcpostgres.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, testcontainers.TerminateContainer(container))
	})

	connectionString, err := container.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	db, err := pgxpool.New(ctx, connectionString)
	require.NoError(t, err)
	require.NoError(t, db.Ping(ctx))
	t.Cleanup(db.Close)

	return db
}

func createTestTransfer(id string, status models.TransferStatus, expiresAt time.Time) models.Transfer {
	now := time.Now().UTC().Truncate(time.Second)
	return models.Transfer{
		ID:              id,
		Status:          status,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
		ManageTokenHash: "manage-token-hash",
	}
}

func int64ptr(value int64) *int64 {
	return &value
}

func skipIfDockerUnavailable(t *testing.T) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping docker-backed integration test in short mode")
	}
	if runtime.GOOS == "windows" {
		t.Skip("skipping docker-backed integration test on windows")
	}

	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skipf("skipping docker-backed integration test: %v", err)
	}
}
