package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoadUsesDefaultsWhenEnvironmentIsUnset(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, "development", cfg.AppEnv)
	require.Equal(t, ":8080", cfg.Addr)
	require.Equal(t, "postgres://xdrop:xdrop@localhost:5432/xdrop?sslmode=disable", cfg.DatabaseURL)
	require.Equal(t, "localhost:6379", cfg.RedisAddr)
	require.Equal(t, "http://localhost:9000", cfg.S3Endpoint)
	require.Equal(t, "http://localhost:5173", cfg.S3PublicEndpoint)
	require.Equal(t, time.Hour, cfg.DefaultExpiry)
	require.Equal(t, 5*time.Minute, cfg.PresignTTL)
	require.Equal(t, []string{"http://localhost:5173", "http://localhost:8080"}, cfg.AllowedOrigins)
	require.Equal(t, 20, cfg.CreateLimit)
	require.Equal(t, 180, cfg.PublicReadLimit)
	require.Equal(t, 120, cfg.DownloadURLLimit)
	require.Equal(t, 2*time.Minute, cfg.CleanupInterval)
	require.Equal(t, int64(8*1024*1024), cfg.ChunkSize)
	require.Equal(t, 100, cfg.MaxFileCount)
	require.Equal(t, int64(256*1024*1024), cfg.MaxTransferBytes)
}

func TestLoadParsesCustomEnvironmentValues(t *testing.T) {
	clearConfigEnv(t)

	t.Setenv("APP_ENV", "production")
	t.Setenv("API_ADDR", ":9090")
	t.Setenv("DATABASE_URL", "postgres://demo:demo@db:5432/demo?sslmode=disable")
	t.Setenv("REDIS_ADDR", "redis:6379")
	t.Setenv("REDIS_PASSWORD", "secret")
	t.Setenv("REDIS_DB", "4")
	t.Setenv("S3_ENDPOINT", "http://minio:9000")
	t.Setenv("S3_PUBLIC_ENDPOINT", "https://files.example.test")
	t.Setenv("S3_REGION", "ap-southeast-1")
	t.Setenv("S3_BUCKET", "custom-bucket")
	t.Setenv("S3_ACCESS_KEY", "key")
	t.Setenv("S3_SECRET_KEY", "secret-key")
	t.Setenv("S3_USE_SSL", "true")
	t.Setenv("PRESIGN_TTL_SECONDS", "600")
	t.Setenv("DEFAULT_EXPIRY_SECONDS", "10800")
	t.Setenv("ALLOWED_ORIGINS", " https://app.example.test, https://admin.example.test ")
	t.Setenv("RATE_LIMIT_CREATE", "7")
	t.Setenv("RATE_LIMIT_PUBLIC_READ", "8")
	t.Setenv("RATE_LIMIT_DOWNLOAD_URLS", "9")
	t.Setenv("CLEANUP_INTERVAL", "45s")
	t.Setenv("CHUNK_SIZE_BYTES", "12345")
	t.Setenv("MAX_FILE_COUNT", "12")
	t.Setenv("MAX_TRANSFER_BYTES", "34567")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, "production", cfg.AppEnv)
	require.Equal(t, ":9090", cfg.Addr)
	require.Equal(t, "postgres://demo:demo@db:5432/demo?sslmode=disable", cfg.DatabaseURL)
	require.Equal(t, "redis:6379", cfg.RedisAddr)
	require.Equal(t, "secret", cfg.RedisPassword)
	require.Equal(t, 4, cfg.RedisDB)
	require.Equal(t, "http://minio:9000", cfg.S3Endpoint)
	require.Equal(t, "https://files.example.test", cfg.S3PublicEndpoint)
	require.Equal(t, "ap-southeast-1", cfg.S3Region)
	require.Equal(t, "custom-bucket", cfg.S3Bucket)
	require.Equal(t, "key", cfg.S3AccessKey)
	require.Equal(t, "secret-key", cfg.S3SecretKey)
	require.True(t, cfg.S3UseSSL)
	require.Equal(t, 10*time.Minute, cfg.PresignTTL)
	require.Equal(t, 3*time.Hour, cfg.DefaultExpiry)
	require.Equal(t, []string{"https://app.example.test", "https://admin.example.test"}, cfg.AllowedOrigins)
	require.Equal(t, 7, cfg.CreateLimit)
	require.Equal(t, 8, cfg.PublicReadLimit)
	require.Equal(t, 9, cfg.DownloadURLLimit)
	require.Equal(t, 45*time.Second, cfg.CleanupInterval)
	require.Equal(t, int64(12345), cfg.ChunkSize)
	require.Equal(t, 12, cfg.MaxFileCount)
	require.Equal(t, int64(34567), cfg.MaxTransferBytes)
}

func TestLoadSupportsLegacyExpiryDays(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("DEFAULT_EXPIRY_DAYS", "3")

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, 72*time.Hour, cfg.DefaultExpiry)
}

func TestLoadRejectsUnsupportedDefaultExpiry(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("DEFAULT_EXPIRY_SECONDS", "42")

	_, err := Load()
	require.ErrorContains(t, err, "DEFAULT_EXPIRY_SECONDS must be one of the supported expiry options")
}

func TestEnvHelpersFallBackOnInvalidValues(t *testing.T) {
	t.Setenv("INT_VALUE", "not-a-number")
	t.Setenv("INT64_VALUE", "nope")
	t.Setenv("DURATION_VALUE", "bad-duration")
	t.Setenv("EXPIRY_SECONDS", "-1")
	t.Setenv("EXPIRY_DAYS", "still-bad")

	require.Equal(t, "fallback", getenv("MISSING_VALUE", "fallback"))
	require.Equal(t, 12, getenvInt("INT_VALUE", 12))
	require.Equal(t, int64(34), getenvInt64("INT64_VALUE", 34))
	require.Equal(t, time.Minute, getenvDuration("DURATION_VALUE", time.Minute))
	require.Equal(t, 2*time.Hour, getenvExpiry("EXPIRY_SECONDS", "EXPIRY_DAYS", 2*time.Hour))

	t.Setenv("EXPIRY_SECONDS", "")
	require.Equal(t, 2*time.Hour, getenvExpiry("EXPIRY_SECONDS", "EXPIRY_DAYS", 2*time.Hour))
}

func TestSplitCSVAndAllowedExpiryHelpers(t *testing.T) {
	t.Parallel()

	require.Equal(t, []string{"https://a.test", "https://b.test"}, splitCSV(" https://a.test, ,https://b.test "))
	require.True(t, IsAllowedExpiry(time.Hour))
	require.False(t, IsAllowedExpiry(2*time.Hour))
}

func clearConfigEnv(t *testing.T) {
	t.Helper()

	for _, key := range []string{
		"APP_ENV",
		"API_ADDR",
		"DATABASE_URL",
		"REDIS_ADDR",
		"REDIS_PASSWORD",
		"REDIS_DB",
		"S3_ENDPOINT",
		"S3_PUBLIC_ENDPOINT",
		"S3_REGION",
		"S3_BUCKET",
		"S3_ACCESS_KEY",
		"S3_SECRET_KEY",
		"S3_USE_SSL",
		"PRESIGN_TTL_SECONDS",
		"DEFAULT_EXPIRY_SECONDS",
		"DEFAULT_EXPIRY_DAYS",
		"ALLOWED_ORIGINS",
		"RATE_LIMIT_CREATE",
		"RATE_LIMIT_PUBLIC_READ",
		"RATE_LIMIT_DOWNLOAD_URLS",
		"CLEANUP_INTERVAL",
		"CHUNK_SIZE_BYTES",
		"MAX_FILE_COUNT",
		"MAX_TRANSFER_BYTES",
	} {
		t.Setenv(key, "")
	}
}
