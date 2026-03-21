package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv           string
	Addr             string
	DatabaseURL      string
	RedisAddr        string
	RedisPassword    string
	RedisDB          int
	S3Endpoint       string
	S3PublicEndpoint string
	S3Region         string
	S3Bucket         string
	S3AccessKey      string
	S3SecretKey      string
	S3UseSSL         bool
	PresignTTL       time.Duration
	DefaultExpiry    time.Duration
	AllowedOrigins   []string
	CreateLimit      int
	PublicReadLimit  int
	DownloadURLLimit int
	CleanupInterval  time.Duration
	ChunkSize        int64
	MaxFileCount     int
	MaxTransferBytes int64
}

// AllowedExpiryOptions is the canonical list of transfer lifetimes accepted by the API.
var AllowedExpiryOptions = []time.Duration{
	5 * time.Minute,
	10 * time.Minute,
	30 * time.Minute,
	1 * time.Hour,
	3 * time.Hour,
	6 * time.Hour,
	12 * time.Hour,
	24 * time.Hour,
	72 * time.Hour,
	7 * 24 * time.Hour,
}

// Load reads environment variables, applies defaults, and validates required settings.
func Load() (Config, error) {
	cfg := Config{
		AppEnv:           getenv("APP_ENV", "development"),
		Addr:             getenv("API_ADDR", ":8080"),
		DatabaseURL:      getenv("DATABASE_URL", "postgres://xdrop:xdrop@localhost:5432/xdrop?sslmode=disable"),
		RedisAddr:        getenv("REDIS_ADDR", "localhost:6379"),
		RedisPassword:    getenv("REDIS_PASSWORD", ""),
		S3Endpoint:       getenv("S3_ENDPOINT", "http://localhost:9000"),
		S3PublicEndpoint: getenv("S3_PUBLIC_ENDPOINT", "http://localhost:5173"),
		S3Region:         getenv("S3_REGION", "us-east-1"),
		S3Bucket:         getenv("S3_BUCKET", "xdrop"),
		S3AccessKey:      getenv("S3_ACCESS_KEY", "minioadmin"),
		S3SecretKey:      getenv("S3_SECRET_KEY", "minioadmin"),
		S3UseSSL:         getenv("S3_USE_SSL", "false") == "true",
		DefaultExpiry:    getenvExpiry("DEFAULT_EXPIRY_SECONDS", "DEFAULT_EXPIRY_DAYS", time.Hour),
		AllowedOrigins:   splitCSV(getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8080")),
		CreateLimit:      getenvInt("RATE_LIMIT_CREATE", 20),
		PublicReadLimit:  getenvInt("RATE_LIMIT_PUBLIC_READ", 180),
		DownloadURLLimit: getenvInt("RATE_LIMIT_DOWNLOAD_URLS", 120),
		CleanupInterval:  getenvDuration("CLEANUP_INTERVAL", 2*time.Minute),
		ChunkSize:        getenvInt64("CHUNK_SIZE_BYTES", 8*1024*1024),
		MaxFileCount:     getenvInt("MAX_FILE_COUNT", 100),
		MaxTransferBytes: getenvInt64("MAX_TRANSFER_BYTES", 256*1024*1024),
	}

	cfg.RedisDB = getenvInt("REDIS_DB", 0)
	presignSeconds := getenvInt("PRESIGN_TTL_SECONDS", 300)
	cfg.PresignTTL = time.Duration(presignSeconds) * time.Second

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.S3Bucket == "" {
		return Config{}, fmt.Errorf("S3_BUCKET is required")
	}
	if !IsAllowedExpiry(cfg.DefaultExpiry) {
		return Config{}, fmt.Errorf("DEFAULT_EXPIRY_SECONDS must be one of the supported expiry options")
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func getenvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func getenvInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}

	return parsed
}

func getenvDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}

	return parsed
}

// getenvExpiry preserves support for the previous day-based variable while preferring seconds.
func getenvExpiry(secondsKey string, legacyDaysKey string, fallback time.Duration) time.Duration {
	if seconds := strings.TrimSpace(os.Getenv(secondsKey)); seconds != "" {
		parsed, err := strconv.Atoi(seconds)
		if err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Second
		}
		return fallback
	}

	if days := strings.TrimSpace(os.Getenv(legacyDaysKey)); days != "" {
		parsed, err := strconv.Atoi(days)
		if err == nil && parsed > 0 {
			return time.Duration(parsed) * 24 * time.Hour
		}
		return fallback
	}

	return fallback
}

// IsAllowedExpiry reports whether a duration matches one of the supported public options.
func IsAllowedExpiry(duration time.Duration) bool {
	for _, option := range AllowedExpiryOptions {
		if duration == option {
			return true
		}
	}

	return false
}

// splitCSV trims whitespace and drops empty values from comma-separated environment settings.
func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	origins := make([]string, 0, len(parts))

	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}

	return origins
}
