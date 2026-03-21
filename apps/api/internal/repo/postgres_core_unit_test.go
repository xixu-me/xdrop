package repo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/models"
)

func TestPostgresRepositoryTransferAccessors(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	transfer := createTestTransfer("transfer-unit", models.TransferStatusReady, now.Add(time.Hour))
	transfer.WrappedRootKey = `{"key":1}`
	transfer.ManifestObjectKey = "transfers/unit/manifest.bin"
	transfer.ManifestCiphertextSize = 88
	transfer.TotalFiles = 2
	transfer.TotalCiphertextBytes = 123
	transfer.FinalizedAt = &now

	t.Run("create transfer success and error", func(t *testing.T) {
		execCalls := 0
		repository := PostgresRepository{db: stubPostgresDB{
			execFn: func(_ context.Context, _ string, _ ...any) error {
				execCalls++
				if execCalls == 2 {
					return errors.New("boom")
				}
				return nil
			},
		}}

		require.NoError(t, repository.CreateTransfer(ctx, transfer))
		err := repository.CreateTransfer(ctx, transfer)
		require.ErrorContains(t, err, "insert transfer")
	})

	t.Run("get transfer handles not found, query errors, and success", func(t *testing.T) {
		call := 0
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				call++
				switch call {
				case 1:
					return stubRow{err: pgx.ErrNoRows}
				case 2:
					return stubRow{err: errors.New("boom")}
				default:
					return stubRow{values: transferScanValues(transfer)}
				}
			},
		}}

		_, err := repository.GetTransfer(ctx, transfer.ID)
		require.ErrorIs(t, err, ErrNotFound)

		_, err = repository.GetTransfer(ctx, transfer.ID)
		require.ErrorContains(t, err, "select transfer")

		stored, err := repository.GetTransfer(ctx, transfer.ID)
		require.NoError(t, err)
		require.Equal(t, transfer.ID, stored.ID)
		require.Equal(t, transfer.ManifestObjectKey, stored.ManifestObjectKey)
		require.Equal(t, transfer.TotalCiphertextBytes, stored.TotalCiphertextBytes)
		require.NotNil(t, stored.FinalizedAt)
	})
}

func TestPostgresRepositoryRegisterFiles(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	files := []models.TransferFile{
		{OpaqueFileID: "file-a", TotalChunks: 2, CiphertextBytes: 64, PlaintextBytes: int64ptr(32), ChunkSize: 32},
		{OpaqueFileID: "file-b", TotalChunks: 1, CiphertextBytes: 16, PlaintextBytes: int64ptr(8), ChunkSize: 16},
	}

	t.Run("success commits after inserting files", func(t *testing.T) {
		execCalls := 0
		tx := &stubPostgresTx{
			execFn: func(context.Context, string, ...any) error {
				execCalls++
				return nil
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		require.NoError(t, repository.RegisterFiles(ctx, "transfer-1", files))
		require.Equal(t, 3, execCalls)
		require.True(t, tx.commitCalled)
	})

	t.Run("begin failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return nil, errors.New("boom")
			},
		}}

		err := repository.RegisterFiles(ctx, "transfer-1", files)
		require.ErrorContains(t, err, "begin register files")
	})

	t.Run("file insert failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, args ...any) error {
				if strings.Contains(sql, "INSERT INTO transfer_files") && args[1] == "file-a" {
					return errors.New("boom")
				}
				return nil
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.RegisterFiles(ctx, "transfer-1", files)
		require.ErrorContains(t, err, "insert file file-a")
	})

	t.Run("status update failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "UPDATE transfers SET status") {
					return errors.New("boom")
				}
				return nil
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.RegisterFiles(ctx, "transfer-1", files)
		require.ErrorContains(t, err, "set uploading status")
	})

	t.Run("commit failure", func(t *testing.T) {
		tx := &stubPostgresTx{commitErr: errors.New("boom")}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.RegisterFiles(ctx, "transfer-1", files)
		require.ErrorContains(t, err, "commit register files")
	})
}

func TestPostgresRepositoryListFiles(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	file := models.TransferFile{
		TransferID:      "transfer-1",
		OpaqueFileID:    "file-a",
		TotalChunks:     2,
		CiphertextBytes: 64,
		PlaintextBytes:  int64ptr(32),
		ChunkSize:       32,
		UploadStatus:    "pending",
		CreatedAt:       time.Now().UTC(),
		UpdatedAt:       time.Now().UTC(),
	}

	t.Run("query failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return nil, errors.New("boom")
			},
		}}

		_, err := repository.ListFiles(ctx, "transfer-1")
		require.ErrorContains(t, err, "query files")
	})

	t.Run("scan failure", func(t *testing.T) {
		rows := &stubRows{values: [][]any{fileScanValues(file)}, scanErrAt: 1, scanErr: errors.New("boom")}
		repository := PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return rows, nil
			},
		}}

		_, err := repository.ListFiles(ctx, "transfer-1")
		require.ErrorContains(t, err, "scan file")
		require.True(t, rows.closed)
	})

	t.Run("iteration failure", func(t *testing.T) {
		rows := &stubRows{values: [][]any{fileScanValues(file)}, err: errors.New("boom")}
		repository := PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return rows, nil
			},
		}}

		_, err := repository.ListFiles(ctx, "transfer-1")
		require.ErrorContains(t, err, "iterate files")
	})

	t.Run("success", func(t *testing.T) {
		rows := &stubRows{values: [][]any{fileScanValues(file)}}
		repository := PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return rows, nil
			},
		}}

		files, err := repository.ListFiles(ctx, "transfer-1")
		require.NoError(t, err)
		require.Len(t, files, 1)
		require.Equal(t, "file-a", files[0].OpaqueFileID)
	})
}

func TestPostgresRepositoryCompleteChunks(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	chunks := []models.TransferChunk{
		{OpaqueFileID: "file-a", ChunkIndex: 0, ObjectKey: "chunk-0", CiphertextSize: 10, ChecksumSHA256: "sum-0"},
		{OpaqueFileID: "file-a", ChunkIndex: 1, ObjectKey: "chunk-1", CiphertextSize: 10, ChecksumSHA256: "sum-1"},
	}

	t.Run("success marks completed files once", func(t *testing.T) {
		totalQueries := 0
		countQueries := 0
		statusUpdates := 0
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "UPDATE transfer_files SET upload_status") {
					statusUpdates++
				}
				return nil
			},
			queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
				switch {
				case strings.Contains(sql, "SELECT total_chunks"):
					totalQueries++
					return stubRow{values: []any{2}}
				case strings.Contains(sql, "SELECT COUNT(*) FROM transfer_chunks"):
					countQueries++
					return stubRow{values: []any{2}}
				default:
					return stubRow{err: fmt.Errorf("unexpected query: %s", sql)}
				}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		require.NoError(t, repository.CompleteChunks(ctx, "transfer-1", chunks))
		require.Equal(t, 1, totalQueries)
		require.Equal(t, 1, countQueries)
		require.Equal(t, 1, statusUpdates)
		require.True(t, tx.commitCalled)
	})

	t.Run("begin failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return nil, errors.New("boom")
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks)
		require.ErrorContains(t, err, "begin complete chunks")
	})

	t.Run("chunk upsert failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "INSERT INTO transfer_chunks") {
					return errors.New("boom")
				}
				return nil
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks)
		require.ErrorContains(t, err, "upsert chunk file-a/0")
	})

	t.Run("select total chunks failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
				if strings.Contains(sql, "SELECT total_chunks") {
					return stubRow{err: errors.New("boom")}
				}
				return stubRow{values: []any{1}}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks[:1])
		require.ErrorContains(t, err, "select file chunk count file-a")
	})

	t.Run("count uploaded chunks failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
				if strings.Contains(sql, "SELECT COUNT(*) FROM transfer_chunks") {
					return stubRow{err: errors.New("boom")}
				}
				return stubRow{values: []any{1}}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks[:1])
		require.ErrorContains(t, err, "count uploaded chunks file-a")
	})

	t.Run("update file status failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "UPDATE transfer_files SET upload_status") {
					return errors.New("boom")
				}
				return nil
			},
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{1}}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks[:1])
		require.ErrorContains(t, err, "update file status file-a")
	})

	t.Run("touch transfer failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "UPDATE transfers SET updated_at") {
					return errors.New("boom")
				}
				return nil
			},
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{1}}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks[:1])
		require.ErrorContains(t, err, "touch transfer")
	})

	t.Run("commit failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			commitErr: errors.New("boom"),
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{1}}
			},
		}
		repository := PostgresRepository{db: stubPostgresDB{
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}}

		err := repository.CompleteChunks(ctx, "transfer-1", chunks[:1])
		require.ErrorContains(t, err, "commit complete chunks")
	})
}

func TestPostgresRepositoryGetResumeState(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	transfer := createTestTransfer("transfer-resume", models.TransferStatusUploading, now.Add(time.Hour))
	file := models.TransferFile{
		TransferID:      transfer.ID,
		OpaqueFileID:    "file-a",
		TotalChunks:     2,
		CiphertextBytes: 64,
		PlaintextBytes:  int64ptr(32),
		ChunkSize:       32,
		UploadStatus:    "pending",
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	t.Run("transfer lookup failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{err: pgx.ErrNoRows}
			},
		}}

		_, err := repository.GetResumeState(ctx, transfer.ID)
		require.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("list files failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: transferScanValues(transfer)}
			},
			queryFn: func(_ context.Context, sql string, _ ...any) (postgresRows, error) {
				if strings.Contains(sql, "FROM transfer_files") {
					return nil, errors.New("boom")
				}
				return &stubRows{}, nil
			},
		}}

		_, err := repository.GetResumeState(ctx, transfer.ID)
		require.ErrorContains(t, err, "query files")
	})

	t.Run("query chunks failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: transferScanValues(transfer)}
			},
			queryFn: func(_ context.Context, sql string, _ ...any) (postgresRows, error) {
				if strings.Contains(sql, "FROM transfer_files") {
					return &stubRows{values: [][]any{fileScanValues(file)}}, nil
				}
				return nil, errors.New("boom")
			},
		}}

		_, err := repository.GetResumeState(ctx, transfer.ID)
		require.ErrorContains(t, err, "query chunks")
	})

	t.Run("scan chunk failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: transferScanValues(transfer)}
			},
			queryFn: func(_ context.Context, sql string, _ ...any) (postgresRows, error) {
				if strings.Contains(sql, "FROM transfer_files") {
					return &stubRows{values: [][]any{fileScanValues(file)}}, nil
				}
				return &stubRows{values: [][]any{{"file-a", 0}}, scanErrAt: 1, scanErr: errors.New("boom")}, nil
			},
		}}

		_, err := repository.GetResumeState(ctx, transfer.ID)
		require.ErrorContains(t, err, "scan chunk")
	})

	t.Run("iterate chunks failure", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: transferScanValues(transfer)}
			},
			queryFn: func(_ context.Context, sql string, _ ...any) (postgresRows, error) {
				if strings.Contains(sql, "FROM transfer_files") {
					return &stubRows{values: [][]any{fileScanValues(file)}}, nil
				}
				return &stubRows{values: [][]any{{"file-a", 0}}, err: errors.New("boom")}, nil
			},
		}}

		_, err := repository.GetResumeState(ctx, transfer.ID)
		require.ErrorContains(t, err, "iterate chunks")
	})

	t.Run("success", func(t *testing.T) {
		repository := PostgresRepository{db: stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: transferScanValues(transfer)}
			},
			queryFn: func(_ context.Context, sql string, _ ...any) (postgresRows, error) {
				if strings.Contains(sql, "FROM transfer_files") {
					return &stubRows{values: [][]any{fileScanValues(file)}}, nil
				}
				return &stubRows{values: [][]any{{"file-a", 0}, {"file-a", 1}}}, nil
			},
		}}

		state, err := repository.GetResumeState(ctx, transfer.ID)
		require.NoError(t, err)
		require.Equal(t, transfer.ID, state.Transfer.ID)
		require.Len(t, state.Files, 1)
		require.Equal(t, []int{0, 1}, state.UploadedChunks["file-a"])
	})
}
