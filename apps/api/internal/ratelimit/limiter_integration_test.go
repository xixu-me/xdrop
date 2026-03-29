package ratelimit

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/testutil"
)

func TestRedisLimiterBlocksThenResetsAfterWindow(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	client := startRedisClient(t, ctx)
	limiter := NewRedisLimiter(client)

	key := "rate-limit:test"
	allowed, err := limiter.Allow(ctx, key, 1, 2*time.Second)
	require.NoError(t, err)
	require.True(t, allowed)

	allowed, err = limiter.Allow(ctx, key, 1, 2*time.Second)
	require.NoError(t, err)
	require.False(t, allowed)

	time.Sleep(2200 * time.Millisecond)

	allowed, err = limiter.Allow(ctx, key, 1, 2*time.Second)
	require.NoError(t, err)
	require.True(t, allowed)
}

func startRedisClient(t *testing.T, ctx context.Context) *redis.Client {
	t.Helper()

	container := testutil.StartDockerContainer(t, ctx, testutil.DockerRunRequest{
		NamePrefix:   "xdrop-redis",
		Image:        "redis:7-alpine",
		ExposedPorts: []string{"6379/tcp"},
	})

	client := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("127.0.0.1:%s", container.PublishedPort(t, ctx, "6379/tcp")),
		DB:   0,
	})
	require.NoError(t, testutil.WaitForCondition(ctx, 60*time.Second, 500*time.Millisecond, func() error {
		return client.Ping(ctx).Err()
	}))
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})

	return client
}

func skipIfDockerUnavailable(t *testing.T) {
	t.Helper()
	testutil.SkipIfDockerUnavailable(t, false)
}
