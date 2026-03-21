package repo

import (
	"context"
	"errors"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsUnit(t *testing.T) {
	t.Parallel()

	t.Run("create schema failure", func(t *testing.T) {
		err := runMigrations(context.Background(), stubPostgresDB{
			execFn: func(context.Context, string, ...any) error {
				return errors.New("boom")
			},
		}, fstest.MapFS{})
		require.ErrorContains(t, err, "create schema_migrations")
	})

	t.Run("read dir failure", func(t *testing.T) {
		err := runMigrations(context.Background(), stubPostgresDB{}, stubMigrationFiles{
			readDirFn: func(string) ([]fs.DirEntry, error) {
				return nil, errors.New("boom")
			},
		})
		require.ErrorContains(t, err, "read migrations")
	})

	t.Run("query existing migration failure", func(t *testing.T) {
		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{err: errors.New("boom")}
			},
		}, fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		})
		require.ErrorContains(t, err, "query migration 001_first.sql")
	})

	t.Run("read migration failure", func(t *testing.T) {
		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
		}, stubMigrationFiles{
			readDirFn: func(string) ([]fs.DirEntry, error) {
				return fstest.MapFS{
					"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
				}.ReadDir("migrations")
			},
			readFileFn: func(string) ([]byte, error) {
				return nil, errors.New("boom")
			},
		})
		require.ErrorContains(t, err, "read migration 001_first.sql")
	})

	t.Run("begin migration failure", func(t *testing.T) {
		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return nil, errors.New("boom")
			},
		}, fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		})
		require.ErrorContains(t, err, "begin migration 001_first.sql")
	})

	t.Run("apply migration failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(context.Context, string, ...any) error {
				return errors.New("boom")
			},
		}

		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}, fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		})

		require.ErrorContains(t, err, "apply migration 001_first.sql")
		require.True(t, tx.rollbackCalled)
	})

	t.Run("record migration failure", func(t *testing.T) {
		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, _ ...any) error {
				if strings.Contains(sql, "INSERT INTO schema_migrations") {
					return errors.New("boom")
				}
				return nil
			},
		}

		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}, fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		})

		require.ErrorContains(t, err, "record migration 001_first.sql")
		require.True(t, tx.rollbackCalled)
	})

	t.Run("commit migration failure", func(t *testing.T) {
		tx := &stubPostgresTx{commitErr: errors.New("boom")}

		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}, fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		})

		require.ErrorContains(t, err, "commit migration 001_first.sql")
	})

	t.Run("success sorts and skips existing migrations", func(t *testing.T) {
		applied := []string{}
		checked := []string{}

		tx := &stubPostgresTx{
			execFn: func(_ context.Context, sql string, args ...any) error {
				if strings.Contains(sql, "INSERT INTO schema_migrations") {
					applied = append(applied, args[0].(string))
				}
				return nil
			},
		}

		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(_ context.Context, _ string, args ...any) postgresRow {
				name := args[0].(string)
				checked = append(checked, name)
				return stubRow{values: []any{name == "001_first.sql"}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}, fstest.MapFS{
			"migrations/002_second.sql": &fstest.MapFile{Data: []byte("select 2;")},
			"migrations/001_first.sql":  &fstest.MapFile{Data: []byte("select 1;")},
		})

		require.NoError(t, err)
		require.Equal(t, []string{"001_first.sql", "002_second.sql"}, checked)
		require.Equal(t, []string{"002_second.sql"}, applied)
	})

	t.Run("ignores directory entries", func(t *testing.T) {
		tx := &stubPostgresTx{}

		err := runMigrations(context.Background(), stubPostgresDB{
			queryRowFn: func(context.Context, string, ...any) postgresRow {
				return stubRow{values: []any{false}}
			},
			beginFn: func(context.Context) (postgresTx, error) {
				return tx, nil
			},
		}, fstest.MapFS{
			"migrations/nested":          &fstest.MapFile{Mode: fs.ModeDir},
			"migrations/001_first.sql":   &fstest.MapFile{Data: []byte("select 1;")},
			"migrations/nested/skip.sql": &fstest.MapFile{Data: []byte("select 2;")},
		})

		require.NoError(t, err)
		require.True(t, tx.commitCalled)
	})

	t.Run("RunMigrations uses the pool wrapper and embedded files", func(t *testing.T) {
		originalFiles := embeddedMigrationFiles
		originalFactory := newMigrationDBFromPool
		t.Cleanup(func() {
			embeddedMigrationFiles = originalFiles
			newMigrationDBFromPool = originalFactory
		})

		embeddedMigrationFiles = fstest.MapFS{
			"migrations/001_first.sql": &fstest.MapFile{Data: []byte("select 1;")},
		}

		tx := &stubPostgresTx{}
		newMigrationDBFromPool = func(*pgxpool.Pool) postgresDB {
			return stubPostgresDB{
				queryRowFn: func(context.Context, string, ...any) postgresRow {
					return stubRow{values: []any{false}}
				},
				beginFn: func(context.Context) (postgresTx, error) {
					return tx, nil
				},
			}
		}

		require.NoError(t, RunMigrations(context.Background(), nil))
		require.True(t, tx.commitCalled)
	})
}
