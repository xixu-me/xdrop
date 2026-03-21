package repo

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

var (
	embeddedMigrationFiles migrationFiles = migrationFS
	newMigrationDBFromPool                = func(db *pgxpool.Pool) postgresDB {
		return pgxPoolDB{pool: livePGXPool{pool: db}}
	}
)

// RunMigrations applies embedded SQL migrations in lexical order and records each one once.
func RunMigrations(ctx context.Context, db *pgxpool.Pool) error {
	return runMigrations(ctx, newMigrationDBFromPool(db), embeddedMigrationFiles)
}

// migrationFiles abstracts embedded files so migration tests can inject custom fixtures.
type migrationFiles interface {
	ReadDir(name string) ([]fs.DirEntry, error)
	ReadFile(name string) ([]byte, error)
}

// runMigrations ensures each migration is executed inside its own transaction.
func runMigrations(ctx context.Context, db postgresDB, files migrationFiles) error {
	if err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := files.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)

	for _, name := range names {
		var exists bool
		if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, name).Scan(&exists); err != nil {
			return fmt.Errorf("query migration %s: %w", name, err)
		}
		if exists {
			continue
		}

		payload, err := files.ReadFile(filepath.ToSlash(filepath.Join("migrations", name)))
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		tx, err := db.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}

		if err = tx.Exec(ctx, string(payload)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if err = tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err = tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}

	return nil
}
