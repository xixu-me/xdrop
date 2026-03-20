package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/models"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
)

func TestCreateTransferStoresHashedManageToken(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)

	response, err := svc.CreateTransfer(context.Background(), "127.0.0.1", CreateTransferRequest{ExpiresInSeconds: 3600})
	require.NoError(t, err)
	require.NotEmpty(t, response.TransferID)
	require.NotEmpty(t, response.ManageToken)

	transfer, err := repository.GetTransfer(context.Background(), response.TransferID)
	require.NoError(t, err)
	require.NotEqual(t, response.ManageToken, transfer.ManageTokenHash)
	require.Len(t, transfer.ManageTokenHash, 64)
}

func TestCreateTransferRejectsUnsupportedExpiry(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)

	_, err := svc.CreateTransfer(context.Background(), "127.0.0.1", CreateTransferRequest{ExpiresInSeconds: 2 * 3600})
	require.Error(t, err)

	httpErr, ok := err.(*HTTPError)
	require.True(t, ok)
	require.Equal(t, 400, httpErr.Status)
	require.Equal(t, "invalid_expiry", httpErr.Code)
}

func TestFinalizeFlowPublishesDescriptor(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)

	create, err := svc.CreateTransfer(context.Background(), "127.0.0.1", CreateTransferRequest{ExpiresInSeconds: 3600})
	require.NoError(t, err)

	err = svc.RegisterFiles(context.Background(), create.TransferID, create.ManageToken, []RegisterFileRequest{
		{
			FileID:          "file_a",
			TotalChunks:     2,
			CiphertextBytes: 64,
			PlaintextBytes:  int64ptr(32),
			ChunkSize:       16,
		},
	})
	require.NoError(t, err)

	err = svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{
		{FileID: "file_a", ChunkIndex: 0, CiphertextSize: 32, ChecksumSHA256: strings.Repeat("a", 64)},
		{FileID: "file_a", ChunkIndex: 1, CiphertextSize: 32, ChecksumSHA256: strings.Repeat("b", 64)},
	})
	require.NoError(t, err)

	ciphertext := base64.StdEncoding.EncodeToString([]byte(`{"version":1}`))
	err = svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
		CiphertextBase64: ciphertext,
	})
	require.NoError(t, err)

	err = svc.FinalizeTransfer(context.Background(), create.TransferID, create.ManageToken, FinalizeTransferRequest{
		WrappedRootKey:       `{"version":1}`,
		TotalFiles:           1,
		TotalCiphertextBytes: 64,
	})
	require.NoError(t, err)

	publicDescriptor, err := svc.GetPublicTransfer(context.Background(), "127.0.0.1", create.TransferID)
	require.NoError(t, err)
	require.Equal(t, "ready", publicDescriptor.Status)
	require.NotEmpty(t, publicDescriptor.ManifestURL)
	require.Equal(t, `{"version":1}`, publicDescriptor.WrappedRootKey)
}

func TestRateLimitBlocksSecondCreate(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	cfg := testConfig()
	cfg.CreateLimit = 1
	svc := New(cfg, repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

	_, err := svc.CreateTransfer(context.Background(), "shared-ip", CreateTransferRequest{ExpiresInSeconds: 3600})
	require.NoError(t, err)

	_, err = svc.CreateTransfer(context.Background(), "shared-ip", CreateTransferRequest{ExpiresInSeconds: 3600})
	require.Error(t, err)

	httpErr, ok := err.(*HTTPError)
	require.True(t, ok)
	require.Equal(t, 429, httpErr.Status)
}

func TestDeleteMakesTransferUnavailable(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)

	create, err := svc.CreateTransfer(context.Background(), "127.0.0.1", CreateTransferRequest{ExpiresInSeconds: 3600})
	require.NoError(t, err)

	readyTransfer, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	readyTransfer.Status = models.TransferStatusReady
	readyTransfer.ManifestObjectKey = "transfers/demo/manifest.bin"
	readyTransfer.WrappedRootKey = `{"version":1}`
	require.NoError(t, repository.CreateOrReplace(readyTransfer))

	err = svc.DeleteTransfer(context.Background(), create.TransferID, create.ManageToken)
	require.NoError(t, err)

	publicDescriptor, err := svc.GetPublicTransfer(context.Background(), "127.0.0.1", create.TransferID)
	require.NoError(t, err)
	require.Equal(t, "deleted", publicDescriptor.Status)
}

func TestCleanupRemovesExpiredPrefixes(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)

	expired := models.Transfer{
		ID:                "expired-transfer",
		Status:            models.TransferStatusReady,
		ManageTokenHash:   hashToken("manage-token"),
		CreatedAt:         time.Now().Add(-48 * time.Hour),
		UpdatedAt:         time.Now().Add(-48 * time.Hour),
		ExpiresAt:         time.Now().Add(-24 * time.Hour),
		ManifestObjectKey: "transfers/expired-transfer/manifest.bin",
		WrappedRootKey:    `{"version":1}`,
	}
	require.NoError(t, repository.CreateOrReplace(expired))

	err := svc.CleanupExpired(context.Background())
	require.NoError(t, err)
	require.Contains(t, storage.deletedPrefixes, "transfers/expired-transfer/")

	transfer, err := repository.GetTransfer(context.Background(), expired.ID)
	require.NoError(t, err)
	require.NotNil(t, transfer.PurgedAt)
}

type memoryRepository struct {
	transfers map[string]models.Transfer
	files     map[string][]models.TransferFile
	chunks    map[string][]models.TransferChunk
}

func newMemoryRepository() *memoryRepository {
	return &memoryRepository{
		transfers: map[string]models.Transfer{},
		files:     map[string][]models.TransferFile{},
		chunks:    map[string][]models.TransferChunk{},
	}
}

func (m *memoryRepository) CreateTransfer(_ context.Context, transfer models.Transfer) error {
	m.transfers[transfer.ID] = transfer
	return nil
}

func (m *memoryRepository) CreateOrReplace(transfer models.Transfer) error {
	m.transfers[transfer.ID] = transfer
	return nil
}

func (m *memoryRepository) GetTransfer(_ context.Context, transferID string) (models.Transfer, error) {
	transfer, ok := m.transfers[transferID]
	if !ok {
		return models.Transfer{}, repo.ErrNotFound
	}
	return transfer, nil
}

func (m *memoryRepository) RegisterFiles(_ context.Context, transferID string, files []models.TransferFile) error {
	m.files[transferID] = append([]models.TransferFile{}, files...)
	transfer := m.transfers[transferID]
	transfer.Status = models.TransferStatusUploading
	m.transfers[transferID] = transfer
	return nil
}

func (m *memoryRepository) ListFiles(_ context.Context, transferID string) ([]models.TransferFile, error) {
	return append([]models.TransferFile{}, m.files[transferID]...), nil
}

func (m *memoryRepository) CompleteChunks(_ context.Context, transferID string, chunks []models.TransferChunk) error {
	m.chunks[transferID] = append(m.chunks[transferID], chunks...)
	files := m.files[transferID]
	for fileIndex := range files {
		uploaded := 0
		for _, chunk := range m.chunks[transferID] {
			if chunk.OpaqueFileID == files[fileIndex].OpaqueFileID {
				uploaded++
			}
		}
		if uploaded >= files[fileIndex].TotalChunks {
			files[fileIndex].UploadStatus = "complete"
		}
	}
	m.files[transferID] = files
	return nil
}

func (m *memoryRepository) GetResumeState(ctx context.Context, transferID string) (models.TransferResumeState, error) {
	transfer, err := m.GetTransfer(ctx, transferID)
	if err != nil {
		return models.TransferResumeState{}, err
	}
	uploaded := map[string][]int{}
	for _, chunk := range m.chunks[transferID] {
		uploaded[chunk.OpaqueFileID] = append(uploaded[chunk.OpaqueFileID], chunk.ChunkIndex)
	}
	return models.TransferResumeState{
		Transfer:       transfer,
		Files:          append([]models.TransferFile{}, m.files[transferID]...),
		UploadedChunks: uploaded,
	}, nil
}

func (m *memoryRepository) SetManifest(_ context.Context, transferID string, objectKey string, ciphertextSize int64) error {
	transfer := m.transfers[transferID]
	transfer.ManifestObjectKey = objectKey
	transfer.ManifestCiphertextSize = ciphertextSize
	m.transfers[transferID] = transfer
	return nil
}

func (m *memoryRepository) FinalizeTransfer(_ context.Context, transferID string, wrappedRootKey string, totalFiles int, totalCiphertextBytes int64) error {
	transfer := m.transfers[transferID]
	if transfer.ManifestObjectKey == "" {
		return fmt.Errorf("manifest missing")
	}
	for _, file := range m.files[transferID] {
		if file.UploadStatus != "complete" {
			return fmt.Errorf("upload incomplete")
		}
	}
	transfer.Status = models.TransferStatusReady
	transfer.WrappedRootKey = wrappedRootKey
	transfer.TotalFiles = totalFiles
	transfer.TotalCiphertextBytes = totalCiphertextBytes
	now := time.Now()
	transfer.FinalizedAt = &now
	m.transfers[transferID] = transfer
	return nil
}

func (m *memoryRepository) UpdateTransfer(_ context.Context, transferID string, params models.UpdateTransferParams) error {
	transfer := m.transfers[transferID]
	if params.ManifestObjectKey != nil {
		transfer.ManifestObjectKey = *params.ManifestObjectKey
	}
	if params.ExpiresAt != nil {
		transfer.ExpiresAt = *params.ExpiresAt
	}
	if params.ManifestCiphertextSize != nil {
		transfer.ManifestCiphertextSize = *params.ManifestCiphertextSize
	}
	m.transfers[transferID] = transfer
	return nil
}

func (m *memoryRepository) MarkDeleted(_ context.Context, transferID string) error {
	transfer := m.transfers[transferID]
	now := time.Now()
	transfer.Status = models.TransferStatusDeleted
	transfer.DeletedAt = &now
	m.transfers[transferID] = transfer
	return nil
}

func (m *memoryRepository) ListCleanupCandidates(_ context.Context, _ int) ([]models.Transfer, error) {
	candidates := []models.Transfer{}
	for _, transfer := range m.transfers {
		if transfer.PurgedAt != nil {
			continue
		}
		if transfer.DeletedAt != nil || transfer.ExpiresAt.Before(time.Now()) {
			candidates = append(candidates, transfer)
		}
	}
	return candidates, nil
}

func (m *memoryRepository) MarkPurged(_ context.Context, transferID string) error {
	transfer := m.transfers[transferID]
	now := time.Now()
	transfer.PurgedAt = &now
	transfer.Status = models.TransferStatusExpired
	m.transfers[transferID] = transfer
	return nil
}

type memoryStorage struct {
	objects         map[string][]byte
	deletedPrefixes []string
}

func (m *memoryStorage) PresignUpload(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	return "https://example.test/upload/" + objectKey, nil
}

func (m *memoryStorage) PresignDownload(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	return "https://example.test/download/" + objectKey, nil
}

func (m *memoryStorage) PutObject(_ context.Context, objectKey string, body []byte, _ string) error {
	if m.objects == nil {
		m.objects = map[string][]byte{}
	}
	m.objects[objectKey] = append([]byte{}, body...)
	return nil
}

func (m *memoryStorage) DeletePrefix(_ context.Context, prefix string) error {
	m.deletedPrefixes = append(m.deletedPrefixes, prefix)
	return nil
}

func (m *memoryStorage) EnsureBucket(_ context.Context) error {
	return nil
}

func newTestService(repository *memoryRepository) *Service {
	return newTestServiceWithStorage(repository, &memoryStorage{})
}

func newTestServiceWithStorage(repository *memoryRepository, storage *memoryStorage) *Service {
	return New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
}

func testConfig() config.Config {
	return config.Config{
		ChunkSize:        8 * 1024 * 1024,
		DefaultExpiry:    time.Hour,
		CreateLimit:      20,
		PublicReadLimit:  120,
		DownloadURLLimit: 120,
		PresignTTL:       5 * time.Minute,
		MaxFileCount:     100,
		MaxTransferBytes: 256 * 1024 * 1024,
	}
}

func int64ptr(value int64) *int64 {
	return &value
}
