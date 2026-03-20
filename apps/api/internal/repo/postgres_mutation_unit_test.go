package repo

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/models"
)

func TestPostgresRepositoryFinalizeUpdateAndCleanup(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	t.Run("set manifest success and error", func(t *testing.T) {
		execCalls := 0
		repository := PostgresRepository{db: stubPostgresDB{
			execFn: func(context.Context, string, ...any) error {
				execCalls++
				if execCalls == 2 {
					return errors.New("boom")
				}
				return nil
			},
		}}

		require.NoError(t, repository.SetManifest(ctx, "transfer-1", "manifest.bin", 88))
		err := repository.SetManifest(ctx, "transfer-1", "manifest.bin", 88)
		require.ErrorContains(t, err, "set manifest")
	})

	t.Run("finalize variants", func(t *testing.T) {
		t.Run("begin failure", func(t *testing.T) {
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return nil, errors.New("boom")
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "begin finalize")
		})

		t.Run("manifest query failure", func(t *testing.T) {
			tx := &stubPostgresTx{
				queryRowFn: func(context.Context, string, ...any) postgresRow {
					return stubRow{err: errors.New("boom")}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "select manifest object key")
		})

		t.Run("requires manifest", func(t *testing.T) {
			tx := &stubPostgresTx{
				queryRowFn: func(context.Context, string, ...any) postgresRow {
					return stubRow{values: []any{""}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "manifest not registered")
		})

		t.Run("incomplete count failure", func(t *testing.T) {
			tx := &stubPostgresTx{
				queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
					if strings.Contains(sql, "SELECT COUNT(*)") {
						return stubRow{err: errors.New("boom")}
					}
					return stubRow{values: []any{"manifest.bin"}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "count incomplete files")
		})

		t.Run("rejects incomplete uploads", func(t *testing.T) {
			tx := &stubPostgresTx{
				queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
					if strings.Contains(sql, "SELECT COUNT(*)") {
						return stubRow{values: []any{1}}
					}
					return stubRow{values: []any{"manifest.bin"}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "upload incomplete")
		})

		t.Run("update failure", func(t *testing.T) {
			tx := &stubPostgresTx{
				execFn: func(context.Context, string, ...any) error {
					return errors.New("boom")
				},
				queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
					if strings.Contains(sql, "SELECT COUNT(*)") {
						return stubRow{values: []any{0}}
					}
					return stubRow{values: []any{"manifest.bin"}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "update finalized transfer")
		})

		t.Run("commit failure", func(t *testing.T) {
			tx := &stubPostgresTx{
				commitErr: errors.New("boom"),
				queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
					if strings.Contains(sql, "SELECT COUNT(*)") {
						return stubRow{values: []any{0}}
					}
					return stubRow{values: []any{"manifest.bin"}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			err := repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10)
			require.ErrorContains(t, err, "commit finalize")
		})

		t.Run("success", func(t *testing.T) {
			tx := &stubPostgresTx{
				queryRowFn: func(_ context.Context, sql string, _ ...any) postgresRow {
					if strings.Contains(sql, "SELECT COUNT(*)") {
						return stubRow{values: []any{0}}
					}
					return stubRow{values: []any{"manifest.bin"}}
				},
			}
			repository := PostgresRepository{db: stubPostgresDB{
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}}

			require.NoError(t, repository.FinalizeTransfer(ctx, "transfer-1", "root", 1, 10))
			require.True(t, tx.commitCalled)
		})
	})

	t.Run("update transfer covers each field and errors", func(t *testing.T) {
		manifestKey := "manifest-renamed.bin"
		expiresAt := now.Add(2 * time.Hour)
		manifestSize := int64(101)
		repository := PostgresRepository{db: stubPostgresDB{
			execFn: func(_ context.Context, _ string, _ ...any) error {
				return nil
			},
		}}

		require.NoError(t, repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ManifestObjectKey:      &manifestKey,
			ManifestCiphertextSize: &manifestSize,
		}))

		err := repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ExpiresAt: &expiresAt,
		})
		require.NoError(t, err)

		err = repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ManifestCiphertextSize: &manifestSize,
		})
		require.NoError(t, err)

		repository = PostgresRepository{db: stubPostgresDB{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "manifest_object_key") {
					return errors.New("boom")
				}
				return nil
			},
		}}

		err = repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ManifestObjectKey: &manifestKey,
		})
		require.ErrorContains(t, err, "update manifest object key")

		repository = PostgresRepository{db: stubPostgresDB{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "expires_at") {
					return errors.New("boom")
				}
				return nil
			},
		}}

		err = repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ExpiresAt: &expiresAt,
		})
		require.ErrorContains(t, err, "update expires_at")

		repository = PostgresRepository{db: stubPostgresDB{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "manifest_ciphertext_size") {
					return errors.New("boom")
				}
				return nil
			},
		}}

		err = repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{
			ManifestCiphertextSize: &manifestSize,
		})
		require.ErrorContains(t, err, "update manifest size")

		noOpCalls := 0
		repository = PostgresRepository{db: stubPostgresDB{
			execFn: func(context.Context, string, ...any) error {
				noOpCalls++
				return nil
			},
		}}
		require.NoError(t, repository.UpdateTransfer(ctx, "transfer-1", models.UpdateTransferParams{}))
		require.Zero(t, noOpCalls)
	})

	t.Run("mark deleted and purged success and error", func(t *testing.T) {
		execCalls := 0
		repository := PostgresRepository{db: stubPostgresDB{
			execFn: func(context.Context, string, ...any) error {
				execCalls++
				if execCalls == 2 || execCalls == 4 {
					return errors.New("boom")
				}
				return nil
			},
		}}

		require.NoError(t, repository.MarkDeleted(ctx, "transfer-1"))
		err := repository.MarkDeleted(ctx, "transfer-1")
		require.ErrorContains(t, err, "mark deleted")

		require.NoError(t, repository.MarkPurged(ctx, "transfer-1"))
		err = repository.MarkPurged(ctx, "transfer-1")
		require.ErrorContains(t, err, "mark purged")
	})

	t.Run("list cleanup candidates handles query, scan, iteration, and success", func(t *testing.T) {
		expired := createTestTransfer("expired", models.TransferStatusReady, now.Add(-time.Hour))
		deleted := createTestTransfer("deleted", models.TransferStatusDeleted, now.Add(time.Hour))
		deletedAt := now.Add(-30 * time.Minute)
		deleted.DeletedAt = &deletedAt

		repository := PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return nil, errors.New("boom")
			},
		}}
		_, err := repository.ListCleanupCandidates(ctx, 10)
		require.ErrorContains(t, err, "query cleanup candidates")

		repository = PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return &stubRows{values: [][]any{transferScanValues(expired)}, scanErrAt: 1, scanErr: errors.New("boom")}, nil
			},
		}}
		_, err = repository.ListCleanupCandidates(ctx, 10)
		require.ErrorContains(t, err, "scan cleanup transfer")

		repository = PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return &stubRows{values: [][]any{transferScanValues(expired)}, err: errors.New("boom")}, nil
			},
		}}
		_, err = repository.ListCleanupCandidates(ctx, 10)
		require.ErrorContains(t, err, "iterate cleanup transfers")

		repository = PostgresRepository{db: stubPostgresDB{
			queryFn: func(context.Context, string, ...any) (postgresRows, error) {
				return &stubRows{values: [][]any{transferScanValues(expired), transferScanValues(deleted)}}, nil
			},
		}}
		candidates, err := repository.ListCleanupCandidates(ctx, 10)
		require.NoError(t, err)
		require.Len(t, candidates, 2)
		require.Equal(t, models.TransferStatusExpired, candidates[0].Status)
		require.Equal(t, models.TransferStatusDeleted, candidates[1].Status)
	})
}
