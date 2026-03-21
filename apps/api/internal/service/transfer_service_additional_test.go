package service

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/models"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
)

func TestHTTPErrorMessageAndExpiryHelpers(t *testing.T) {
	t.Parallel()

	t.Run("http error exposes message", func(t *testing.T) {
		t.Parallel()

		err := &HTTPError{Message: "plain message"}
		require.Equal(t, "plain message", err.Error())
	})

	t.Run("requested create expiry supports days and fallback", func(t *testing.T) {
		t.Parallel()

		duration, err := requestedCreateExpiry(CreateTransferRequest{ExpiresInDays: 1}, 12*time.Hour)
		require.NoError(t, err)
		require.Equal(t, 24*time.Hour, duration)

		duration, err = requestedCreateExpiry(CreateTransferRequest{}, 7*24*time.Hour)
		require.NoError(t, err)
		require.Equal(t, 7*24*time.Hour, duration)
	})

	t.Run("requested update expiry supports days and noop", func(t *testing.T) {
		t.Parallel()

		days := 7
		duration, shouldUpdate, err := requestedUpdateExpiry(UpdateTransferRequest{ExpiresInDays: &days})
		require.NoError(t, err)
		require.True(t, shouldUpdate)
		require.Equal(t, 7*24*time.Hour, duration)

		duration, shouldUpdate, err = requestedUpdateExpiry(UpdateTransferRequest{})
		require.NoError(t, err)
		require.False(t, shouldUpdate)
		require.Zero(t, duration)
	})
}

func TestCreateTransferPropagatesLimiterAndRepositoryErrors(t *testing.T) {
	t.Parallel()

	t.Run("limiter error", func(t *testing.T) {
		t.Parallel()

		svc := New(testConfig(), newMemoryRepository(), &memoryStorage{}, errorLimiter{err: errors.New("redis unavailable")})

		_, err := svc.CreateTransfer(context.Background(), "198.51.100.10", CreateTransferRequest{ExpiresInSeconds: 3600})
		require.ErrorContains(t, err, "rate limit check")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository:  newMemoryRepository(),
			createTransferErr: errors.New("insert failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		_, err := svc.CreateTransfer(context.Background(), "198.51.100.10", CreateTransferRequest{ExpiresInSeconds: 3600})
		require.ErrorContains(t, err, "create transfer")
	})
}

func TestCreateTransferPropagatesRandomTokenFailures(t *testing.T) {
	originalReadRandom := readRandom
	t.Cleanup(func() {
		readRandom = originalReadRandom
	})

	t.Run("transfer id generation", func(t *testing.T) {
		readRandom = func([]byte) (int, error) {
			return 0, errors.New("entropy failed")
		}

		svc := newTestService(newMemoryRepository())
		_, err := svc.CreateTransfer(context.Background(), "198.51.100.10", CreateTransferRequest{ExpiresInSeconds: 3600})
		require.ErrorContains(t, err, "generate transfer id")
	})

	t.Run("manage token generation", func(t *testing.T) {
		calls := 0
		readRandom = func(buffer []byte) (int, error) {
			calls++
			if calls == 2 {
				return 0, errors.New("entropy failed")
			}
			for index := range buffer {
				buffer[index] = byte(index + 1)
			}
			return len(buffer), nil
		}

		svc := newTestService(newMemoryRepository())
		_, err := svc.CreateTransfer(context.Background(), "198.51.100.10", CreateTransferRequest{ExpiresInSeconds: 3600})
		require.ErrorContains(t, err, "generate manage token")
	})
}

func TestCreateUploadURLsHandlesExpiryAndStorageFailures(t *testing.T) {
	t.Parallel()

	t.Run("expired transfer", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		registerFileForTest(t, svc, create.TransferID, create.ManageToken)
		expireTransfer(t, repository, create.TransferID)

		_, err := svc.CreateUploadURLs(context.Background(), create.TransferID, create.ManageToken, UploadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		requireHTTPError(t, err, 410, "expired")
	})

	t.Run("presign failure", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage:    &memoryStorage{},
			presignUploadErr: errors.New("presign upload failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		registerFileForTest(t, svc, create.TransferID, create.ManageToken)

		_, err := svc.CreateUploadURLs(context.Background(), create.TransferID, create.ManageToken, UploadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		require.ErrorContains(t, err, "presign upload")
	})

	t.Run("list files failure", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			listFilesErr:     errors.New("query failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)

		_, err := svc.CreateUploadURLs(context.Background(), create.TransferID, create.ManageToken, UploadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		require.ErrorContains(t, err, "list files")
	})
}

func TestCreateUploadURLsReturnsPresignedItems(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)
	registerFileForTest(t, svc, create.TransferID, create.ManageToken)

	items, err := svc.CreateUploadURLs(context.Background(), create.TransferID, create.ManageToken, UploadURLRequest{
		Chunks: []UploadChunkRequest{
			{FileID: "file-a", ChunkIndex: 0},
			{FileID: "file-a", ChunkIndex: 1},
		},
	})
	require.NoError(t, err)
	require.Len(t, items, 2)
	require.Equal(t, "file-a", items[0].FileID)
	require.Equal(t, 0, items[0].ChunkIndex)
	require.Contains(t, items[0].URL, chunkObjectKey(create.TransferID, "file-a", 0))
}

func TestCompleteChunksHandlesExpiryAndRepositoryFailures(t *testing.T) {
	t.Parallel()

	t.Run("expired transfer", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		registerFileForTest(t, svc, create.TransferID, create.ManageToken)
		expireTransfer(t, repository, create.TransferID)

		err := svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{{
			FileID:         "file-a",
			ChunkIndex:     0,
			CiphertextSize: 32,
			ChecksumSHA256: "checksum",
		}})
		requireHTTPError(t, err, 410, "expired")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository:  newMemoryRepository(),
			completeChunksErr: errors.New("upsert failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		registerFileForTest(t, svc, create.TransferID, create.ManageToken)

		err := svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{{
			FileID:         "file-a",
			ChunkIndex:     0,
			CiphertextSize: 32,
			ChecksumSHA256: "checksum",
		}})
		require.ErrorContains(t, err, "complete chunks")
	})

	t.Run("repository lookup error during authorization", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{memoryRepository: newMemoryRepository()}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		repository.getTransferErr = errors.New("lookup failed")

		err := svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{{
			FileID:         "file-a",
			ChunkIndex:     0,
			CiphertextSize: 32,
			ChecksumSHA256: "checksum",
		}})
		require.ErrorContains(t, err, "lookup failed")
	})
}

func TestManageAuthorizedMethodsPropagateAuthorizationFailures(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)

	requireHTTPError(
		t,
		svc.RegisterFiles(context.Background(), create.TransferID, "", []RegisterFileRequest{{
			FileID:          "file-a",
			TotalChunks:     1,
			CiphertextBytes: 32,
			ChunkSize:       32,
		}}),
		401,
		"missing_manage_token",
	)

	_, err := svc.CreateUploadURLs(context.Background(), create.TransferID, "", UploadURLRequest{
		Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
	})
	requireHTTPError(t, err, 401, "missing_manage_token")

	err = svc.PutManifest(context.Background(), create.TransferID, "", ManifestUploadRequest{
		CiphertextBase64: base64.StdEncoding.EncodeToString([]byte("manifest")),
	})
	requireHTTPError(t, err, 401, "missing_manage_token")

	err = svc.FinalizeTransfer(context.Background(), create.TransferID, "", FinalizeTransferRequest{
		WrappedRootKey:       "wrapped",
		TotalFiles:           1,
		TotalCiphertextBytes: 32,
	})
	requireHTTPError(t, err, 401, "missing_manage_token")

	err = svc.UpdateTransfer(context.Background(), create.TransferID, "", UpdateTransferRequest{})
	requireHTTPError(t, err, 401, "missing_manage_token")
}

func TestCompleteChunksRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)

	err := svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{{
		FileID:         " ",
		ChunkIndex:     0,
		CiphertextSize: 32,
		ChecksumSHA256: "checksum",
	}})
	requireHTTPError(t, err, 400, "invalid_chunk_completion")
}

func TestPutManifestHandlesExpiryAndFailures(t *testing.T) {
	t.Parallel()

	t.Run("expired transfer", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		expireTransfer(t, repository, create.TransferID)

		err := svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
			CiphertextBase64: base64.StdEncoding.EncodeToString([]byte("manifest")),
		})
		requireHTTPError(t, err, 410, "expired")
	})

	t.Run("storage error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage: &memoryStorage{},
			putObjectErr:  errors.New("upload failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)

		err := svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
			CiphertextBase64: base64.StdEncoding.EncodeToString([]byte("manifest")),
		})
		require.ErrorContains(t, err, "put manifest")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			setManifestErr:   errors.New("update failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)

		err := svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
			CiphertextBase64: base64.StdEncoding.EncodeToString([]byte("manifest")),
		})
		require.ErrorContains(t, err, "set manifest")
	})
}

func TestFinalizeTransferHandlesExpiryAndRepositoryFailures(t *testing.T) {
	t.Parallel()

	t.Run("expired transfer", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		expireTransfer(t, repository, create.TransferID)

		err := svc.FinalizeTransfer(context.Background(), create.TransferID, create.ManageToken, FinalizeTransferRequest{
			WrappedRootKey:       "wrapped",
			TotalFiles:           1,
			TotalCiphertextBytes: 32,
		})
		requireHTTPError(t, err, 410, "expired")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
		}
		storage := &memoryStorage{}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		registerFileForTest(t, svc, create.TransferID, create.ManageToken)
		require.NoError(t, svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{
			{FileID: "file-a", ChunkIndex: 0, CiphertextSize: 32, ChecksumSHA256: "a"},
			{FileID: "file-a", ChunkIndex: 1, CiphertextSize: 32, ChecksumSHA256: "b"},
		}))
		require.NoError(t, svc.PutManifest(context.Background(), create.TransferID, create.ManageToken, ManifestUploadRequest{
			CiphertextBase64: base64.StdEncoding.EncodeToString([]byte("manifest")),
		}))
		repository.finalizeErr = errors.New("finalize failed")

		err := svc.FinalizeTransfer(context.Background(), create.TransferID, create.ManageToken, FinalizeTransferRequest{
			WrappedRootKey:       "wrapped",
			TotalFiles:           1,
			TotalCiphertextBytes: 64,
		})
		require.ErrorContains(t, err, "finalize failed")
	})
}

func TestGetManageTransferAndResumeTransferReturnState(t *testing.T) {
	t.Parallel()

	repository := newMemoryRepository()
	svc := newTestService(repository)
	create := createTransferForTest(t, svc)
	registerFileForTest(t, svc, create.TransferID, create.ManageToken)
	require.NoError(t, svc.CompleteChunks(context.Background(), create.TransferID, create.ManageToken, []CompleteChunkRequest{{
		FileID:         "file-a",
		ChunkIndex:     0,
		CiphertextSize: 32,
		ChecksumSHA256: "checksum",
	}}))

	manage, err := svc.GetManageTransfer(context.Background(), create.TransferID, create.ManageToken)
	require.NoError(t, err)
	require.Equal(t, create.TransferID, manage.ID)
	require.Len(t, manage.Files, 1)
	require.Equal(t, "file-a", manage.Files[0].FileID)
	require.Equal(t, []int{0}, manage.UploadedChunks["file-a"])

	resume, err := svc.ResumeTransfer(context.Background(), create.TransferID, create.ManageToken)
	require.NoError(t, err)
	require.Equal(t, manage, resume)
}

func TestGetManageTransferPropagatesResumeErrors(t *testing.T) {
	t.Parallel()

	repository := &failingRepository{
		memoryRepository:  newMemoryRepository(),
		getResumeStateErr: errors.New("resume failed"),
	}
	svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
	create := createTransferForTest(t, svc)

	_, err := svc.GetManageTransfer(context.Background(), create.TransferID, create.ManageToken)
	require.ErrorContains(t, err, "resume failed")
}

func TestUpdateTransferHandlesInvalidManifestAndRepositoryErrors(t *testing.T) {
	t.Parallel()

	t.Run("invalid manifest", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		expirySeconds := 3600

		err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
			ExpiresInSeconds: &expirySeconds,
			CiphertextBase64: "not-base64",
		})
		requireHTTPError(t, err, 400, "invalid_manifest")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			updateErr:        errors.New("update failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		expirySeconds := 3600

		err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
			ExpiresInSeconds: &expirySeconds,
		})
		require.ErrorContains(t, err, "update transfer")
	})

	t.Run("invalid expiry", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)
		expirySeconds := 2 * 3600

		err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
			ExpiresInSeconds: &expirySeconds,
		})
		requireHTTPError(t, err, 400, "invalid_expiry")
	})

	t.Run("storage error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage: &memoryStorage{},
			putObjectErr:  errors.New("upload failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		ciphertext := base64.StdEncoding.EncodeToString([]byte("updated-manifest"))

		err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{
			CiphertextBase64: ciphertext,
		})
		require.ErrorContains(t, err, "put updated manifest")
	})

	t.Run("no-op update", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)

		err := svc.UpdateTransfer(context.Background(), create.TransferID, create.ManageToken, UpdateTransferRequest{})
		require.NoError(t, err)
	})
}

func TestDeleteTransferHandlesRepositoryAndStorageFailures(t *testing.T) {
	t.Parallel()

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			markDeletedErr:   errors.New("delete failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)

		err := svc.DeleteTransfer(context.Background(), create.TransferID, create.ManageToken)
		require.ErrorContains(t, err, "delete transfer")
	})

	t.Run("storage delete prefix errors are ignored", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage:   &memoryStorage{},
			deletePrefixErr: errors.New("delete prefix failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)

		err := svc.DeleteTransfer(context.Background(), create.TransferID, create.ManageToken)
		require.NoError(t, err)

		transfer, getErr := repository.GetTransfer(context.Background(), create.TransferID)
		require.NoError(t, getErr)
		require.Equal(t, models.TransferStatusDeleted, transfer.Status)
	})

	t.Run("missing token", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := newTestService(repository)
		create := createTransferForTest(t, svc)

		err := svc.DeleteTransfer(context.Background(), create.TransferID, "")
		requireHTTPError(t, err, 401, "missing_manage_token")
	})
}

func TestRegisterFilesPropagatesRepositoryErrors(t *testing.T) {
	t.Parallel()

	repository := &failingRepository{
		memoryRepository: newMemoryRepository(),
		registerFilesErr: errors.New("insert files failed"),
	}
	svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())
	create := createTransferForTest(t, svc)

	err := svc.RegisterFiles(context.Background(), create.TransferID, create.ManageToken, []RegisterFileRequest{{
		FileID:          "file-a",
		TotalChunks:     1,
		CiphertextBytes: 32,
		ChunkSize:       32,
	}})
	require.ErrorContains(t, err, "register files")
}

func TestGetPublicTransferHandlesLimiterAndPresignFailures(t *testing.T) {
	t.Parallel()

	t.Run("limiter error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		svc := New(testConfig(), repository, &memoryStorage{}, errorLimiter{err: errors.New("redis unavailable")})

		_, err := svc.GetPublicTransfer(context.Background(), "198.51.100.10", "transfer-id")
		require.ErrorContains(t, err, "rate limit check")
	})

	t.Run("presign error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage:      &memoryStorage{},
			presignDownloadErr: errors.New("presign download failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		makeReadyTransferForTest(t, svc, create.TransferID, create.ManageToken)

		_, err := svc.GetPublicTransfer(context.Background(), "198.51.100.10", create.TransferID)
		require.ErrorContains(t, err, "presign manifest download")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			getTransferErr:   errors.New("lookup failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		_, err := svc.GetPublicTransfer(context.Background(), "198.51.100.10", "transfer-id")
		require.ErrorContains(t, err, "lookup failed")
	})
}

func TestCreateDownloadURLsHandlesNotFoundAndPresignFailures(t *testing.T) {
	t.Parallel()

	t.Run("not found", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository:  newMemoryRepository(),
			getResumeStateErr: repo.ErrNotFound,
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.10", "missing-transfer", DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		requireHTTPError(t, err, 404, "not_found")
	})

	t.Run("presign error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &failingStorage{
			memoryStorage:      &memoryStorage{},
			presignDownloadErr: errors.New("presign download failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())
		create := createTransferForTest(t, svc)
		makeReadyTransferForTest(t, svc, create.TransferID, create.ManageToken)

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.10", create.TransferID, DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		require.ErrorContains(t, err, "presign chunk download")
	})

	t.Run("limiter error", func(t *testing.T) {
		t.Parallel()

		svc := New(testConfig(), newMemoryRepository(), &memoryStorage{}, errorLimiter{err: errors.New("redis unavailable")})

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.10", "transfer-id", DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		require.ErrorContains(t, err, "rate limit check")
	})

	t.Run("repository error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository:  newMemoryRepository(),
			getResumeStateErr: errors.New("resume failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.10", "transfer-id", DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "file-a", ChunkIndex: 0}},
		})
		require.ErrorContains(t, err, "resume failed")
	})

	t.Run("requested file is unavailable", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		storage := &memoryStorage{}
		svc := newTestServiceWithStorage(repository, storage)
		create := createTransferForTest(t, svc)
		makeReadyTransferForTest(t, svc, create.TransferID, create.ManageToken)

		_, err := svc.CreateDownloadURLs(context.Background(), "198.51.100.10", create.TransferID, DownloadURLRequest{
			Chunks: []UploadChunkRequest{{FileID: "missing-file", ChunkIndex: 0}},
		})
		requireHTTPError(t, err, 400, "invalid_download_request")
	})
}

func TestCleanupExpiredHandlesRepositoryAndStorageFailures(t *testing.T) {
	t.Parallel()

	t.Run("list cleanup candidates error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			listCleanupErr:   errors.New("list failed"),
		}
		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		err := svc.CleanupExpired(context.Background())
		require.ErrorContains(t, err, "list cleanup candidates")
	})

	t.Run("delete prefix error", func(t *testing.T) {
		t.Parallel()

		repository := newMemoryRepository()
		expired := createExpiredTransferForCleanup()
		require.NoError(t, repository.CreateOrReplace(expired))

		storage := &failingStorage{
			memoryStorage:   &memoryStorage{},
			deletePrefixErr: errors.New("delete failed"),
		}
		svc := New(testConfig(), repository, storage, ratelimit.NewMemoryLimiter())

		err := svc.CleanupExpired(context.Background())
		require.ErrorContains(t, err, "delete transfer objects")
	})

	t.Run("mark purged error", func(t *testing.T) {
		t.Parallel()

		repository := &failingRepository{
			memoryRepository: newMemoryRepository(),
			markPurgedErr:    errors.New("mark purged failed"),
		}
		expired := createExpiredTransferForCleanup()
		require.NoError(t, repository.CreateOrReplace(expired))

		svc := New(testConfig(), repository, &memoryStorage{}, ratelimit.NewMemoryLimiter())

		err := svc.CleanupExpired(context.Background())
		require.ErrorContains(t, err, "mark purged")
	})
}

func createExpiredTransferForCleanup() models.Transfer {
	return models.Transfer{
		ID:              "expired-for-cleanup",
		Status:          models.TransferStatusReady,
		ManageTokenHash: hashToken("manage-token"),
		CreatedAt:       time.Now().UTC().Add(-48 * time.Hour),
		UpdatedAt:       time.Now().UTC().Add(-48 * time.Hour),
		ExpiresAt:       time.Now().UTC().Add(-time.Hour),
	}
}

type errorLimiter struct {
	err error
}

func (l errorLimiter) Allow(context.Context, string, int, time.Duration) (bool, error) {
	return false, l.err
}

type failingRepository struct {
	*memoryRepository
	createTransferErr error
	getTransferErr    error
	registerFilesErr  error
	listFilesErr      error
	completeChunksErr error
	getResumeStateErr error
	setManifestErr    error
	finalizeErr       error
	updateErr         error
	markDeletedErr    error
	listCleanupErr    error
	markPurgedErr     error
}

func (r *failingRepository) CreateTransfer(ctx context.Context, transfer models.Transfer) error {
	if r.createTransferErr != nil {
		return r.createTransferErr
	}
	return r.memoryRepository.CreateTransfer(ctx, transfer)
}

func (r *failingRepository) GetTransfer(ctx context.Context, transferID string) (models.Transfer, error) {
	if r.getTransferErr != nil {
		return models.Transfer{}, r.getTransferErr
	}
	return r.memoryRepository.GetTransfer(ctx, transferID)
}

func (r *failingRepository) RegisterFiles(ctx context.Context, transferID string, files []models.TransferFile) error {
	if r.registerFilesErr != nil {
		return r.registerFilesErr
	}
	return r.memoryRepository.RegisterFiles(ctx, transferID, files)
}

func (r *failingRepository) ListFiles(ctx context.Context, transferID string) ([]models.TransferFile, error) {
	if r.listFilesErr != nil {
		return nil, r.listFilesErr
	}
	return r.memoryRepository.ListFiles(ctx, transferID)
}

func (r *failingRepository) CompleteChunks(ctx context.Context, transferID string, chunks []models.TransferChunk) error {
	if r.completeChunksErr != nil {
		return r.completeChunksErr
	}
	return r.memoryRepository.CompleteChunks(ctx, transferID, chunks)
}

func (r *failingRepository) GetResumeState(ctx context.Context, transferID string) (models.TransferResumeState, error) {
	if r.getResumeStateErr != nil {
		return models.TransferResumeState{}, r.getResumeStateErr
	}
	return r.memoryRepository.GetResumeState(ctx, transferID)
}

func (r *failingRepository) SetManifest(ctx context.Context, transferID string, objectKey string, ciphertextSize int64) error {
	if r.setManifestErr != nil {
		return r.setManifestErr
	}
	return r.memoryRepository.SetManifest(ctx, transferID, objectKey, ciphertextSize)
}

func (r *failingRepository) FinalizeTransfer(ctx context.Context, transferID string, wrappedRootKey string, totalFiles int, totalCiphertextBytes int64) error {
	if r.finalizeErr != nil {
		return r.finalizeErr
	}
	return r.memoryRepository.FinalizeTransfer(ctx, transferID, wrappedRootKey, totalFiles, totalCiphertextBytes)
}

func (r *failingRepository) UpdateTransfer(ctx context.Context, transferID string, params models.UpdateTransferParams) error {
	if r.updateErr != nil {
		return r.updateErr
	}
	return r.memoryRepository.UpdateTransfer(ctx, transferID, params)
}

func (r *failingRepository) MarkDeleted(ctx context.Context, transferID string) error {
	if r.markDeletedErr != nil {
		return r.markDeletedErr
	}
	return r.memoryRepository.MarkDeleted(ctx, transferID)
}

func (r *failingRepository) ListCleanupCandidates(ctx context.Context, limit int) ([]models.Transfer, error) {
	if r.listCleanupErr != nil {
		return nil, r.listCleanupErr
	}
	return r.memoryRepository.ListCleanupCandidates(ctx, limit)
}

func (r *failingRepository) MarkPurged(ctx context.Context, transferID string) error {
	if r.markPurgedErr != nil {
		return r.markPurgedErr
	}
	return r.memoryRepository.MarkPurged(ctx, transferID)
}

type failingStorage struct {
	*memoryStorage
	presignUploadErr   error
	presignDownloadErr error
	putObjectErr       error
	deletePrefixErr    error
}

func (s *failingStorage) PresignUpload(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	if s.presignUploadErr != nil {
		return "", s.presignUploadErr
	}
	return s.memoryStorage.PresignUpload(ctx, objectKey, ttl)
}

func (s *failingStorage) PresignDownload(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	if s.presignDownloadErr != nil {
		return "", s.presignDownloadErr
	}
	return s.memoryStorage.PresignDownload(ctx, objectKey, ttl)
}

func (s *failingStorage) PutObject(ctx context.Context, objectKey string, body []byte, contentType string) error {
	if s.putObjectErr != nil {
		return s.putObjectErr
	}
	return s.memoryStorage.PutObject(ctx, objectKey, body, contentType)
}

func (s *failingStorage) DeletePrefix(ctx context.Context, prefix string) error {
	if s.deletePrefixErr != nil {
		return s.deletePrefixErr
	}
	return s.memoryStorage.DeletePrefix(ctx, prefix)
}

func (s *failingStorage) EnsureBucket(context.Context) error {
	return nil
}
