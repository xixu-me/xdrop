package repo

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewPostgresRepositoryWrapsPoolBackedDB(t *testing.T) {
	t.Parallel()

	repository := NewPostgresRepository(nil)
	wrapped, ok := repository.db.(pgxPoolDB)

	require.True(t, ok)
	require.Nil(t, wrapped.pool)
}
