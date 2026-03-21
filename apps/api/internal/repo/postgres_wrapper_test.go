package repo

import (
	"context"
	"errors"
	"testing"

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
	livePool, ok := wrapped.pool.(livePGXPool)
	require.True(t, ok)
	pool, ok := livePool.pool.(*pgxpool.Pool)
	require.True(t, ok)
	require.Nil(t, pool)
}

func TestLivePGXPoolBeginReturnsErrors(t *testing.T) {
	t.Parallel()

	pool := livePGXPool{pool: stubLivePGXPool{beginErr: errors.New("boom")}}

	_, err := pool.Begin(context.Background())
	require.ErrorContains(t, err, "boom")
}

func TestPGXPoolDBDelegatesToPool(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	tx := &stubPGXTx{queryRowResult: stubRow{values: []any{"tx-row"}}}
	pool := &stubPGXPool{
		beginTx:        tx,
		queryRows:      &stubRows{values: [][]any{{"pool-row"}}},
		queryRowResult: stubRow{values: []any{"pool-scalar"}},
	}
	database := pgxPoolDB{pool: pool}

	beginResult, err := database.Begin(ctx)
	require.NoError(t, err)

	require.NoError(t, database.Exec(ctx, "SELECT 1"))

	rows, err := database.Query(ctx, "SELECT 'pool-row'")
	require.NoError(t, err)
	require.True(t, rows.Next())
	var rowValue string
	require.NoError(t, rows.Scan(&rowValue))
	require.Equal(t, "pool-row", rowValue)

	var scalar string
	require.NoError(t, database.QueryRow(ctx, "SELECT 'pool-scalar'").Scan(&scalar))
	require.Equal(t, "pool-scalar", scalar)

	var txValue string
	require.NoError(t, beginResult.QueryRow(ctx, "SELECT 'tx-row'").Scan(&txValue))
	require.Equal(t, "tx-row", txValue)

	require.NoError(t, beginResult.Exec(ctx, "UPDATE test SET ok = true"))
	require.NoError(t, beginResult.Commit(ctx))
	require.NoError(t, beginResult.Rollback(ctx))

	require.Equal(t, 1, pool.beginCalls)
	require.Equal(t, 1, pool.execCalls)
	require.Equal(t, 1, pool.queryCalls)
	require.Equal(t, 1, pool.queryRowCalls)
	require.True(t, tx.commitCalled)
	require.True(t, tx.rollbackCalled)
	require.Equal(t, 1, tx.execCalls)
	require.Equal(t, 1, tx.queryRowCalls)
}

func TestPGXPoolDBBeginReturnsErrors(t *testing.T) {
	t.Parallel()

	database := pgxPoolDB{pool: &stubPGXPool{beginErr: errors.New("boom")}}

	_, err := database.Begin(context.Background())
	require.ErrorContains(t, err, "boom")
}

type stubPGXPool struct {
	beginCalls     int
	beginErr       error
	beginTx        pgxTxAdapter
	execCalls      int
	queryCalls     int
	queryRowCalls  int
	queryRows      postgresRows
	queryRowResult postgresRow
}

func (p *stubPGXPool) Begin(context.Context) (pgxTxAdapter, error) {
	p.beginCalls++
	if p.beginErr != nil {
		return nil, p.beginErr
	}
	return p.beginTx, nil
}

func (p *stubPGXPool) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	p.execCalls++
	return pgconn.CommandTag{}, nil
}

func (p *stubPGXPool) Query(context.Context, string, ...any) (postgresRows, error) {
	p.queryCalls++
	return p.queryRows, nil
}

func (p *stubPGXPool) QueryRow(context.Context, string, ...any) postgresRow {
	p.queryRowCalls++
	return p.queryRowResult
}

type stubPGXTx struct {
	commitCalled   bool
	execCalls      int
	queryRowCalls  int
	queryRowResult postgresRow
	rollbackCalled bool
}

func (tx *stubPGXTx) Commit(context.Context) error {
	tx.commitCalled = true
	return nil
}

func (tx *stubPGXTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	tx.execCalls++
	return pgconn.CommandTag{}, nil
}

func (tx *stubPGXTx) QueryRow(context.Context, string, ...any) postgresRow {
	tx.queryRowCalls++
	return tx.queryRowResult
}

func (tx *stubPGXTx) Rollback(context.Context) error {
	tx.rollbackCalled = true
	return nil
}

type stubLivePGXPool struct {
	beginErr error
}

func (p stubLivePGXPool) Begin(context.Context) (pgx.Tx, error) {
	return nil, p.beginErr
}

func (stubLivePGXPool) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (stubLivePGXPool) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, nil
}

func (stubLivePGXPool) QueryRow(context.Context, string, ...any) pgx.Row {
	return stubRow{}
}
