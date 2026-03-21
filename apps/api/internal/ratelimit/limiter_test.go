package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestMemoryLimiterAllowsUpToLimitThenBlocks(t *testing.T) {
	t.Parallel()

	limiter := NewMemoryLimiter()

	allowed, err := limiter.Allow(context.Background(), "client-a", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, allowed)

	allowed, err = limiter.Allow(context.Background(), "client-a", 2, time.Minute)
	require.NoError(t, err)
	require.True(t, allowed)

	allowed, err = limiter.Allow(context.Background(), "client-a", 2, time.Minute)
	require.NoError(t, err)
	require.False(t, allowed)
}

func TestMemoryLimiterResetsAfterWindow(t *testing.T) {
	t.Parallel()

	limiter := NewMemoryLimiter()

	allowed, err := limiter.Allow(context.Background(), "client-a", 1, 10*time.Millisecond)
	require.NoError(t, err)
	require.True(t, allowed)

	allowed, err = limiter.Allow(context.Background(), "client-a", 1, 10*time.Millisecond)
	require.NoError(t, err)
	require.False(t, allowed)

	time.Sleep(25 * time.Millisecond)

	allowed, err = limiter.Allow(context.Background(), "client-a", 1, 10*time.Millisecond)
	require.NoError(t, err)
	require.True(t, allowed)
}

func TestMemoryLimiterAllowsNonPositiveLimits(t *testing.T) {
	t.Parallel()

	limiter := NewMemoryLimiter()

	for _, limit := range []int{0, -1} {
		allowed, err := limiter.Allow(context.Background(), "client-a", limit, time.Minute)
		require.NoError(t, err)
		require.True(t, allowed)
	}
}

func TestRedisLimiterAllowsNonPositiveLimits(t *testing.T) {
	t.Parallel()

	allowed, err := NewRedisLimiter(nil).Allow(context.Background(), "client-a", 0, time.Minute)
	require.NoError(t, err)
	require.True(t, allowed)
}

func TestRedisLimiterReturnsPipelineErrors(t *testing.T) {
	t.Parallel()

	client := redis.NewClient(&redis.Options{
		Addr:         "127.0.0.1:1",
		DialTimeout:  20 * time.Millisecond,
		ReadTimeout:  20 * time.Millisecond,
		WriteTimeout: 20 * time.Millisecond,
	})
	t.Cleanup(func() {
		_ = client.Close()
	})

	allowed, err := NewRedisLimiter(client).Allow(context.Background(), "client-a", 1, time.Minute)
	require.False(t, allowed)
	require.ErrorContains(t, err, "exec rate limit pipeline")
}
