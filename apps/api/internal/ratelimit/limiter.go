package ratelimit

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limiter decides whether a caller may proceed within a given fixed time window.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}

// RedisLimiter stores counters in Redis so limits can be shared across API instances.
type RedisLimiter struct {
	client *redis.Client
}

// NewRedisLimiter builds a Redis-backed limiter for production deployments.
func NewRedisLimiter(client *redis.Client) *RedisLimiter {
	return &RedisLimiter{client: client}
}

// Allow increments the caller key and compares the result with the configured limit.
func (l *RedisLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if limit <= 0 {
		return true, nil
	}

	pipeline := l.client.TxPipeline()
	countCmd := pipeline.Incr(ctx, key)
	pipeline.Expire(ctx, key, window)

	if _, err := pipeline.Exec(ctx); err != nil {
		return false, fmt.Errorf("exec rate limit pipeline: %w", err)
	}

	return countCmd.Val() <= int64(limit), nil
}

// MemoryLimiter provides an in-process limiter for tests and single-node development.
type MemoryLimiter struct {
	mu      sync.Mutex
	entries map[string]memoryEntry
}

type memoryEntry struct {
	count    int
	deadline time.Time
}

// NewMemoryLimiter builds an empty in-memory limiter state.
func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{
		entries: map[string]memoryEntry{},
	}
}

// Allow applies the same fixed-window semantics as RedisLimiter without external state.
func (l *MemoryLimiter) Allow(_ context.Context, key string, limit int, window time.Duration) (bool, error) {
	if limit <= 0 {
		return true, nil
	}

	now := time.Now()

	l.mu.Lock()
	defer l.mu.Unlock()

	entry, ok := l.entries[key]
	if !ok || now.After(entry.deadline) {
		entry = memoryEntry{count: 0, deadline: now.Add(window)}
	}

	entry.count++
	l.entries[key] = entry

	return entry.count <= limit, nil
}
