package repo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPGXPoolDBAndPGXTxAdapters(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	pool := startPostgresTestDB(t, ctx)
	database := pgxPoolDB{pool: pool}

	require.NoError(t, database.Exec(ctx, `CREATE TEMP TABLE adapter_test (id text PRIMARY KEY)`))

	rows, err := database.Query(ctx, `SELECT 'row-value'`)
	require.NoError(t, err)
	require.True(t, rows.Next())
	var rowValue string
	require.NoError(t, rows.Scan(&rowValue))
	require.Equal(t, "row-value", rowValue)
	rows.Close()
	require.NoError(t, rows.Err())

	var scalar string
	require.NoError(t, database.QueryRow(ctx, `SELECT 'query-row-value'`).Scan(&scalar))
	require.Equal(t, "query-row-value", scalar)

	tx, err := database.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, tx.Exec(ctx, `INSERT INTO adapter_test (id) VALUES ($1)`, "committed"))
	require.NoError(t, tx.QueryRow(ctx, `SELECT id FROM adapter_test WHERE id = $1`, "committed").Scan(&scalar))
	require.Equal(t, "committed", scalar)
	require.NoError(t, tx.Commit(ctx))

	tx, err = database.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, tx.Exec(ctx, `INSERT INTO adapter_test (id) VALUES ($1)`, "rolled-back"))
	require.NoError(t, tx.Rollback(ctx))

	rows, err = database.Query(ctx, `SELECT id FROM adapter_test ORDER BY id`)
	require.NoError(t, err)
	defer rows.Close()

	values := []string{}
	for rows.Next() {
		var id string
		require.NoError(t, rows.Scan(&id))
		values = append(values, id)
	}
	require.NoError(t, rows.Err())
	require.Equal(t, []string{"committed"}, values)
}
