package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestNewPostgresRepositoryWrapsPoolBackedDB(t *testing.T) {
	t.Parallel()

	repository := NewPostgresRepository(nil)
	wrapped, ok := repository.db.(pgxPoolDB)

	require.True(t, ok)
	require.Nil(t, wrapped.pool)
}

type wrapperStubRow struct {
	err error
}

func (row wrapperStubRow) Scan(dest ...any) error {
	_ = dest
	return row.err
}

type wrapperStubTx struct {
	commitErr    error
	rollbackErr  error
	execErr      error
	queryRow     pgx.Row
	execSQL      string
	queryRowSQL  string
	execArgs     []any
	queryRowArgs []any
}

func (tx *wrapperStubTx) Begin(context.Context) (pgx.Tx, error) {
	return tx, nil
}

func (tx *wrapperStubTx) Commit(context.Context) error {
	return tx.commitErr
}

func (tx *wrapperStubTx) Rollback(context.Context) error {
	return tx.rollbackErr
}

func (tx *wrapperStubTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("unexpected CopyFrom call")
}

func (tx *wrapperStubTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	panic("unexpected SendBatch call")
}

func (tx *wrapperStubTx) LargeObjects() pgx.LargeObjects {
	return pgx.LargeObjects{}
}

func (tx *wrapperStubTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("unexpected Prepare call")
}

func (tx *wrapperStubTx) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	tx.execSQL = sql
	tx.execArgs = arguments
	return pgconn.CommandTag{}, tx.execErr
}

func (tx *wrapperStubTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unexpected Query call")
}

func (tx *wrapperStubTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	tx.queryRowSQL = sql
	tx.queryRowArgs = args
	return tx.queryRow
}

func (tx *wrapperStubTx) Conn() *pgx.Conn {
	return nil
}

func TestPgxTxDelegatesToTheUnderlyingTransaction(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	row := wrapperStubRow{err: errors.New("scan failed")}
	tx := &wrapperStubTx{
		commitErr:   errors.New("commit failed"),
		rollbackErr: errors.New("rollback failed"),
		execErr:     errors.New("exec failed"),
		queryRow:    row,
	}
	wrapped := pgxTx{tx: tx}

	require.ErrorIs(t, wrapped.Commit(ctx), tx.commitErr)
	require.ErrorIs(t, wrapped.Exec(ctx, "select 1", "arg"), tx.execErr)
	require.Equal(t, "select 1", tx.execSQL)
	require.Equal(t, []any{"arg"}, tx.execArgs)
	require.Equal(t, row, wrapped.QueryRow(ctx, "select 2", 42))
	require.Equal(t, "select 2", tx.queryRowSQL)
	require.Equal(t, []any{42}, tx.queryRowArgs)
	require.ErrorIs(t, wrapped.Rollback(ctx), tx.rollbackErr)
}

func TestPgxPoolDBMethodsDelegateThroughThePool(t *testing.T) {
	t.Parallel()

	config, err := pgxpool.ParseConfig("postgres://xdrop:xdrop@127.0.0.1:1/xdrop?sslmode=disable")
	require.NoError(t, err)
	config.ConnConfig.ConnectTimeout = 20 * time.Millisecond

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	wrapped := pgxPoolDB{pool: pool}

	_, err = wrapped.Begin(ctx)
	require.Error(t, err)

	err = wrapped.Exec(ctx, "select 1")
	require.Error(t, err)

	_, err = wrapped.Query(ctx, "select 1")
	require.Error(t, err)

	row := wrapped.QueryRow(ctx, "select 1")
	require.NotNil(t, row)
	require.Error(t, row.Scan(new(int)))
}
