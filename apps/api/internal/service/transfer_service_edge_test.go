package service

import (
	"context"
	"encoding/base64"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/models"
)

func TestGetManageTransferRejectsMissingInvalidAndUnknownTokens(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)

	_, err := svc.GetManageTransfer(context.Background(), create.TransferID, "")
	requireHTTPError(t, err, 401, "missing_manage_token")

	_, err = svc.GetManageTransfer(context.Background(), create.TransferID, "wrong-token")
	requireHTTPError(t, err, 403, "invalid_manage_token")

	_, err = svc.GetManageTransfer(context.Background(), "missing-transfer", "present-token")
	requireHTTPError(t, err, 404, "not_found")
}

func TestRegisterFilesRejectsInvalidInputs(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		files []RegisterFileRequest
		code  string
	}{
		{
			name:  "empty files",
			files: nil,
			code:  "empty_files",
		},
		{
			name: "too many files",
			files: func() []RegisterFileRequest {
				files := make([]RegisterFileRequest, testConfig().MaxFileCount+1)
				for i := range files {
					files[i] = RegisterFileRequest{
						FileID:          "file",
						TotalChunks:     1,
						CiphertextBytes: 1,
						ChunkSize:       1,
					}
				}
				return files
			}(),
			code: "too_many_files",
		},
		{
			name: "blank file id",
			files: []RegisterFileRequest{{
				FileID:          " ",
				TotalChunks:     1,
				CiphertextBytes: 1,
				ChunkSize:       1,
			}},
			code: "invalid_file_registration",
		},
		{
			name: "zero chunk size",
			files: []RegisterFileRequest{{
				FileID:          "file-a",
				TotalChunks:     1,
				CiphertextBytes: 1,
				ChunkSize:       0,
			}},
			code: "invalid_file_registration",
		},
		{
			name: "transfer too large",
			files: []RegisterFileRequest{{
				FileID:          "file-a",
				TotalChunks:     1,
				CiphertextBytes: testConfig().MaxTransferBytes + 1,
				ChunkSize:       1,
			}},
			code: "transfer_too_large",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			repository := newMemoryRepository()
			svc := newTestService(repository)
			create := createTransferForTest(t, svc)

			err := svc.RegisterFiles(context.Background(), create.TransferID, create.ManageToken, tc.files)
			requireHTTPError(t, err, 400, tc.code)
		})
	}
}

func TestRegisterFilesRejectsExpiredTransfer(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)
	expireTransfer(t, repository, create.TransferID)

	err := svc.RegisterFiles(context.Background(), create.TransferID, create.ManageToken, []RegisterFileRequest{{
		FileID:          "file-a",
		TotalChunks:     1,
		CiphertextBytes: 1,
		ChunkSize:       1,
	}})
	requireHTTPError(t, err, 410, "expired")
}

func TestCreateUploadURLsRejectsUnknownAndOutOfRangeChunks(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)
	registerFileForTest(t, svc, create.TransferID, create.ManageToken)

	testCases := []struct {
		name  string
		chunk UploadChunkRequest
	}{
		{
			name:  "unknown file",
			chunk: UploadChunkRequest{FileID: "missing-file", ChunkIndex: 0},
		},
		{
			name:  "negative index",
			chunk: UploadChunkRequest{FileID: "file-a", ChunkIndex: -1},
		},
		{
			name:  "past total chunks",
			chunk: UploadChunkRequest{FileID: "file-a", ChunkIndex: 2},
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, err := svc.CreateUploadURLs(context.Background(), create.TransferID, create.ManageToken, UploadURLRequest{
				Chunks: []UploadChunkRequest{tc.chunk},
			})
			requireHTTPError(t, err, 400, "invalid_chunk_request")
		})
	}
}

func TestPutManifestRejectsInvalidCiphertext(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)

	err := svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
		CiphertextBase64: "not-base64",
	})
	requireHTTPError(t, err, 400, "invalid_manifest")

	err = svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
		CiphertextBase64: "",
	})
	requireHTTPError(t, err, 400, "invalid_manifest")
}

func TestFinalizeTransferRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)
	create := createTransferForTest(t, svc)
	registerFileForTest(t, svc, create.TransferID, create.ManageToken)

	err := svc.FinalizeTransfer(context.Background(), create.TransferID, create.ManageToken, FinalizeTransferRequest{
		WrappedRootKey:       "",
		TotalFiles:           1,
		TotalCiphertextBytes: 16,
	})
	requireHTTPError(t, err, 400, "invalid_finalize")
}

func TestUpdateTransferUpdatesExpiryAndManifest(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)
	create := createTransferForTest(t, svc)

	transfer, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	transfer.ManifestObjectKey = "transfers/custom/manifest.bin"
	require.NoError(t, repository.CreateOrReplace(transfer))

	ciphertext := []byte(`{"version":2}`)
	expirySeconds := 3 * 3600
	err = svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
		ExpiresInSeconds: &expirySeconds,
		CiphertextBase64: base64.StdEncoding.EncodeToString(ciphertext),
	})
	require.NoError(t, err)

	updated, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	require.Equal(t, int64(len(ciphertext)), updated.ManifestCiphertextSize)
	require.WithinDuration(t, time.Now().UTC().Add(3*time.Hour), updated.ExpiresAt, 3*time.Second)
	require.Equal(t, ciphertext, storage.objects["transfers/custom/manifest.bin"])
}

func TestUpdateTransferGeneratesManifestObjectKeyWhenMissing(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	storage := &memoryStorage{}
	svc := newTestServiceWithStorage(repository, storage)
	create := createTransferForTest(t, svc)

	ciphertext := []byte(`{"renamed":true}`)
	err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
		CiphertextBase64: base64.StdEncoding.EncodeToString(ciphertext),
	})
	require.NoError(t, err)

	updated, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	require.Equal(t, manifestObjectKey(create.TransferID), updated.ManifestObjectKey)
	require.Equal(t, int64(len(ciphertext)), updated.ManifestCiphertextSize)
	require.Equal(t, ciphertext, storage.objects[manifestObjectKey(create.TransferID)])
}

func TestUpdateTransferRejectsDeletedTransfer(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)

	transfer, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	now := time.Now().UTC()
	transfer.Status = models.TransferStatusDeleted
	transfer.DeletedAt = &now
	require.NoError(t, repository.CreateOrReplace(transfer))

	expirySeconds := 3600
	err = svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
		ExpiresInSeconds: &expirySeconds,
	})
	requireHTTPError(t, err, 410, "deleted")
}

func TestGetPublicTransferReturnsNotFoundAndExpiredStatuses(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)

	_, err := svc.GetPublicTransfer(context.Background(), "198.51.100.20", "missing-transfer")
	requireHTTPError(t, err, 404, "not_found")

	create := createTransferForTest(t, svc)
	transfer, err := repository.GetTransfer(context.Background(), create.TransferID)
	require.NoError(t, err)
	transfer.Status = models.TransferStatusReady
	transfer.ManifestObjectKey = manifestObjectKey(create.TransferID)
	transfer.WrappedRootKey = `{"version":1}`
	transfer.ExpiresAt = time.Now().UTC().Add(-time.Minute)
	require.NoError(t, repository.CreateOrReplace(transfer))

	response, err := svc.GetPublicTransfer(context.Background(), "198.51.100.20", create.TransferID)
	require.NoError(t, err)
	require.Equal(t, "expired", response.Status)
	require.Empty(t, response.ManifestURL)
	require.Empty(t, response.WrappedRootKey)
}

func TestCreateDownloadURLsValidatesAvailabilityAndChunkPresence(t *testing.T) {
	t.Parallel()

	t.Run("transfer not ready", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.20", create.TransferID, DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		requireHTTPError(t, err, 409, "transfer_unavailable")
	})

	t.Run("invalid chunk request", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &memoryStorage{}
		svc := newTestServiceWithStorage(repository, storage)
		create := createTransferForTest(t, svc)
		makeReadyTransferForTest(t, svc, create.TransferID, create.ManageToken)

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.20", create.TransferID, DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 99}},
		})
		requireHTTPError(t, err, 400, "invalid_download_request")
	})

	t.Run("returns presigned url for uploaded chunk", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &memoryStorage{}
		svc := newTestServiceWithStorage(repository, storage)
		create := createTransferForTest(t, svc)
		makeReadyTransferForTest(t, svc, create.TransferID, create.ManageToken)

		items, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.20", create.TransferID, DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 1}},
		})
		require.NoError(t, err)
		require.Len(t, items, 1)
		require.Equal(t, "file-a", items[0].FileID)
		require.Equal(t, 1, items[0].ChunkIndex)
		require.Contains(t, items[0].URL, chunkObjectKey(create.TransferID, "file-a", 1))
	})
}

func createTransferForTest(t *testing.T, svc *Service) CreateTransferResponse {
	t.Helper()

	response, err := svc.CreateTransfer(context.Background(), "198.51.100.10", CreateTransferRequest{
		ExpiresInSeconds: 3600,
	})
	require.NoError(t, err)
	return response
}

func registerFileForTest(t *testing.T, svc *Service, transferID string, manageToken string) {
	t.Helper()

	err := svc.RegisterFiles(context.Background(), transferID, manageToken, []RegisterFileRequest{{
		FileID:          "file-a",
		TotalChunks:     2,
		CiphertextBytes: 64,
		PlaintextBytes:  int64ptr(32),
		ChunkSize:       32,
	}})
	require.NoError(t, err)
}

func makeReadyTransferForTest(t *testing.T, svc *Service, transferID string, manageToken string) {
	t.Helper()

	registerFileForTest(t, svc, transferID, manageToken)

	err := svc.CompleteChunks(context.Background(), transferID, manageToken, []CompleteChunkRequest{
		{FileID: "file-a", ChunkIndex: 0, CiphertextSize: 32, ChecksumSHA256: "a"},
		{FileID: "file-a", ChunkIndex: 1, CiphertextSize: 32, ChecksumSHA256: "b"},
	})
	require.NoError(t, err)

	err = svc.PutManifest(context.Background(), transferID, manageToken, ManifestUploadRequest{
		CiphertextBase64: base64.StdEncoding.EncodeToString([]byte(`{"version":1}`)),
	})
	require.NoError(t, err)

	err = svc.FinalizeTransfer(context.Background(), transferID, manageToken, FinalizeTransferRequest{
		WrappedRootKey:       `{"version":1}`,
		TotalFiles:           1,
		TotalCiphertextBytes: 64,
	})
	require.NoError(t, err)
}

func expireTransfer(t *testing.T, repository *memoryRepository, transferID string) {
	t.Helper()

	transfer, err := repository.GetTransfer(context.Background(), transferID)
	require.NoError(t, err)
	transfer.ExpiresAt = time.Now().UTC().Add(-time.Minute)
	require.NoError(t, repository.CreateOrReplace(transfer))
}

func requireHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()

	require.Error(t, err)

	httpErr, ok := err.(*HTTPError)
	require.True(t, ok)
	require.Equal(t, status, httpErr.Status)
	require.Equal(t, code, httpErr.Code)
}
