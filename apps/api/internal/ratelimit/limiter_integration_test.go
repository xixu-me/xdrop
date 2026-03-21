package ratelimit

import (
	"context"
	"fmt"
	"os/exec"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
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

	container, err := testcontainers.Run(
		ctx,
		"redis:7-alpine",
		testcontainers.WithExposedPorts("6379/tcp"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("Ready to accept connections").WithStartupTimeout(60*time.Second),
		),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, testcontainers.TerminateContainer(container))
	})

	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "6379/tcp")
	require.NoError(t, err)

	client := redis.NewClient(&redis.Options{
		Addr: fmt.Sprintf("%s:%s", host, port.Port()),
		DB:   0,
	})
	require.NoError(t, client.Ping(ctx).Err())
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})

	return client
}

func skipIfDockerUnavailable(t *testing.T) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping docker-backed integration test in short mode")
	}

	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skipf("skipping docker-backed integration test: %v", err)
	}
}
