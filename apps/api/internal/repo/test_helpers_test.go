package repo

import (
	"context"
	"fmt"
	"io/fs"
	"reflect"

	"github.com/xdrop/monorepo/internal/models"
)

type stubMigrationFiles struct {
	readDirFn  func(name string) ([]fs.DirEntry, error)
	readFileFn func(name string) ([]byte, error)
}

func (f stubMigrationFiles) ReadDir(name string) ([]fs.DirEntry, error) {
	if f.readDirFn != nil {
		return f.readDirFn(name)
	}
	return nil, nil
}

func (f stubMigrationFiles) ReadFile(name string) ([]byte, error) {
	if f.readFileFn != nil {
		return f.readFileFn(name)
	}
	return nil, nil
}

type stubPostgresDB struct {
	beginFn    func(ctx context.Context) (postgresTx, error)
	execFn     func(ctx context.Context, sql string, args ...any) error
	queryFn    func(ctx context.Context, sql string, args ...any) (postgresRows, error)
	queryRowFn func(ctx context.Context, sql string, args ...any) postgresRow
}

func (db stubPostgresDB) Begin(ctx context.Context) (postgresTx, error) {
	if db.beginFn != nil {
		return db.beginFn(ctx)
	}
	return &stubPostgresTx{}, nil
}

func (db stubPostgresDB) Exec(ctx context.Context, sql string, args ...any) error {
	if db.execFn != nil {
		return db.execFn(ctx, sql, args...)
	}
	return nil
}

func (db stubPostgresDB) Query(ctx context.Context, sql string, args ...any) (postgresRows, error) {
	if db.queryFn != nil {
		return db.queryFn(ctx, sql, args...)
	}
	return &stubRows{}, nil
}

func (db stubPostgresDB) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	if db.queryRowFn != nil {
		return db.queryRowFn(ctx, sql, args...)
	}
	return stubRow{}
}

type stubPostgresTx struct {
	commitCalled   bool
	commitErr      error
	execFn         func(ctx context.Context, sql string, args ...any) error
	queryRowFn     func(ctx context.Context, sql string, args ...any) postgresRow
	rollbackCalled bool
	rollbackErr    error
}

func (tx *stubPostgresTx) Commit(context.Context) error {
	tx.commitCalled = true
	return tx.commitErr
}

func (tx *stubPostgresTx) Exec(ctx context.Context, sql string, args ...any) error {
	if tx.execFn != nil {
		return tx.execFn(ctx, sql, args...)
	}
	return nil
}

func (tx *stubPostgresTx) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	if tx.queryRowFn != nil {
		return tx.queryRowFn(ctx, sql, args...)
	}
	return stubRow{}
}

func (tx *stubPostgresTx) Rollback(context.Context) error {
	tx.rollbackCalled = true
	return tx.rollbackErr
}

type stubRow struct {
	err    error
	values []any
}

func (r stubRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScanValues(dest, r.values)
}

type stubRows struct {
	closed    bool
	err       error
	index     int
	scanErr   error
	scanErrAt int
	values    [][]any
}

func (r *stubRows) Close() {
	r.closed = true
}

func (r *stubRows) Err() error {
	return r.err
}

func (r *stubRows) Next() bool {
	if r.index >= len(r.values) {
		return false
	}
	r.index++
	return true
}

func (r *stubRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.index == r.scanErrAt {
		return r.scanErr
	}
	return assignScanValues(dest, r.values[r.index-1])
}

func assignScanValues(dest []any, values []any) error {
	if len(dest) != len(values) {
		return fmt.Errorf("scan value count mismatch: %d != %d", len(dest), len(values))
	}

	for i := range dest {
		target := reflect.ValueOf(dest[i])
		if !target.IsValid() || target.Kind() != reflect.Pointer || target.IsNil() {
			return fmt.Errorf("scan target %d is not a pointer", i)
		}

		elem := target.Elem()
		if values[i] == nil {
			elem.Set(reflect.Zero(elem.Type()))
			continue
		}

		value := reflect.ValueOf(values[i])
		switch {
		case value.Type().AssignableTo(elem.Type()):
			elem.Set(value)
		case value.Type().ConvertibleTo(elem.Type()):
			elem.Set(value.Convert(elem.Type()))
		default:
			return fmt.Errorf("cannot assign %s to %s", value.Type(), elem.Type())
		}
	}

	return nil
}

func transferScanValues(transfer models.Transfer) []any {
	return []any{
		transfer.ID,
		transfer.Status,
		transfer.WrappedRootKey,
		transfer.ManifestObjectKey,
		transfer.ManifestCiphertextSize,
		transfer.TotalFiles,
		transfer.TotalCiphertextBytes,
		transfer.ExpiresAt,
		transfer.CreatedAt,
		transfer.UpdatedAt,
		transfer.FinalizedAt,
		transfer.ManageTokenHash,
		transfer.DeletedAt,
		transfer.PurgedAt,
	}
}

func fileScanValues(file models.TransferFile) []any {
	return []any{
		file.TransferID,
		file.OpaqueFileID,
		file.TotalChunks,
		file.CiphertextBytes,
		file.PlaintextBytes,
		file.ChunkSize,
		file.UploadStatus,
		file.CreatedAt,
		file.UpdatedAt,
	}
}
