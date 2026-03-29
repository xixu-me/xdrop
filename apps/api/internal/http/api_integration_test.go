package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	nethttp "net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/service"
	"github.com/xdrop/monorepo/internal/storage"
	"github.com/xdrop/monorepo/internal/testutil"
)

func TestAPITransferLifecycleEndToEnd(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	stack := startHTTPIntegrationStack(t, ctx)

	router := NewRouter(
		stack.cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		service.New(
			stack.cfg,
			repo.NewPostgresRepository(stack.db),
			stack.objectStorage,
			ratelimit.NewRedisLimiter(stack.redisClient),
		),
	)
	server := httptest.NewServer(router)
	defer server.Close()

	httpClient := server.Client()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/", "", map[string]int{
		"expiresInSeconds": 3600,
	}, &createResponse)
	require.NotEmpty(t, createResponse.TransferID)
	require.NotEmpty(t, createResponse.ManageToken)

	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/"+createResponse.TransferID+"/files", createResponse.ManageToken, []map[string]any{
		{
			"fileId":          "file-a",
			"totalChunks":     1,
			"ciphertextBytes": 5,
			"plaintextBytes":  3,
			"chunkSize":       3,
		},
	}, nil)

	uploadURLs := struct {
		Items []struct {
			FileID     string `json:"fileId"`
			ChunkIndex int    `json:"chunkIndex"`
			ObjectKey  string `json:"objectKey"`
			URL        string `json:"url"`
		} `json:"items"`
	}{}
	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/"+createResponse.TransferID+"/upload-urls", createResponse.ManageToken, map[string]any{
		"chunks": []map[string]any{{"fileId": "file-a", "chunkIndex": 0}},
	}, &uploadURLs)
	require.Len(t, uploadURLs.Items, 1)

	chunkCiphertext := []byte("chunk")
	uploadRequest, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodPut, uploadURLs.Items[0].URL, bytes.NewReader(chunkCiphertext))
	require.NoError(t, err)
	uploadRequest.Header.Set("Content-Type", "application/octet-stream")
	uploadResponse, err := httpClient.Do(uploadRequest)
	require.NoError(t, err)
	uploadResponse.Body.Close()
	require.Equal(t, nethttp.StatusOK, uploadResponse.StatusCode)

	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/"+createResponse.TransferID+"/chunks/complete", createResponse.ManageToken, []map[string]any{
		{
			"fileId":         "file-a",
			"chunkIndex":     0,
			"ciphertextSize": len(chunkCiphertext),
			"checksumSha256": "deadbeef",
		},
	}, nil)

	manifestCiphertext := []byte(`{"version":1}`)
	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/"+createResponse.TransferID+"/manifest", createResponse.ManageToken, map[string]string{
		"ciphertextBase64": base64.StdEncoding.EncodeToString(manifestCiphertext),
	}, nil)

	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/transfers/"+createResponse.TransferID+"/finalize", createResponse.ManageToken, map[string]any{
		"wrappedRootKey":       `{"wrapped":true}`,
		"totalFiles":           1,
		"totalCiphertextBytes": len(chunkCiphertext),
	}, nil)

	publicTransfer := struct {
		Status                 string `json:"status"`
		WrappedRootKey         string `json:"wrappedRootKey"`
		ManifestURL            string `json:"manifestUrl"`
		ManifestCiphertextSize int64  `json:"manifestCiphertextSize"`
	}{}
	doJSON(t, httpClient, nethttp.MethodGet, server.URL+"/api/v1/public/transfers/"+createResponse.TransferID+"/", "", nil, &publicTransfer)
	require.Equal(t, "ready", publicTransfer.Status)
	require.Equal(t, `{"wrapped":true}`, publicTransfer.WrappedRootKey)
	require.NotEmpty(t, publicTransfer.ManifestURL)
	require.Equal(t, int64(len(manifestCiphertext)), publicTransfer.ManifestCiphertextSize)

	manifestResponse, err := httpClient.Get(publicTransfer.ManifestURL)
	require.NoError(t, err)
	defer manifestResponse.Body.Close()
	require.Equal(t, nethttp.StatusOK, manifestResponse.StatusCode)
	manifestBody, err := io.ReadAll(manifestResponse.Body)
	require.NoError(t, err)
	require.Equal(t, manifestCiphertext, manifestBody)

	downloadURLs := struct {
		Items []struct {
			FileID     string `json:"fileId"`
			ChunkIndex int    `json:"chunkIndex"`
			URL        string `json:"url"`
		} `json:"items"`
	}{}
	doJSON(t, httpClient, nethttp.MethodPost, server.URL+"/api/v1/public/transfers/"+createResponse.TransferID+"/download-urls", "", map[string]any{
		"chunks": []map[string]any{{"fileId": "file-a", "chunkIndex": 0}},
	}, &downloadURLs)
	require.Len(t, downloadURLs.Items, 1)

	downloadResponse, err := httpClient.Get(downloadURLs.Items[0].URL)
	require.NoError(t, err)
	defer downloadResponse.Body.Close()
	require.Equal(t, nethttp.StatusOK, downloadResponse.StatusCode)
	downloadedChunk, err := io.ReadAll(downloadResponse.Body)
	require.NoError(t, err)
	require.Equal(t, chunkCiphertext, downloadedChunk)
}

type httpIntegrationStack struct {
	cfg           config.Config
	db            *pgxpool.Pool
	redisClient   *redis.Client
	objectStorage *storage.S3Storage
}

func startHTTPIntegrationStack(t *testing.T, ctx context.Context) httpIntegrationStack {
	t.Helper()

	db := startHTTPPostgresDB(t, ctx)
	require.NoError(t, repo.RunMigrations(ctx, db))

	redisClient := startHTTPRedisClient(t, ctx)
	objectStorage, cfg := startHTTPStorage(t, ctx)

	return httpIntegrationStack{
		cfg:           cfg,
		db:            db,
		redisClient:   redisClient,
		objectStorage: objectStorage,
	}
}

func startHTTPPostgresDB(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()

	container := testutil.StartDockerContainer(t, ctx, testutil.DockerRunRequest{
		NamePrefix: "xdrop-http-postgres",
		Image:      "postgres:16-alpine",
		Env: map[string]string{
			"POSTGRES_DB":       "xdrop",
			"POSTGRES_USER":     "xdrop",
			"POSTGRES_PASSWORD": "xdrop",
		},
		ExposedPorts: []string{"5432/tcp"},
	})

	connectionString := fmt.Sprintf(
		"postgres://xdrop:xdrop@127.0.0.1:%s/xdrop?sslmode=disable",
		container.PublishedPort(t, ctx, "5432/tcp"),
	)
	db, err := pgxpool.New(ctx, connectionString)
	require.NoError(t, err)
	t.Cleanup(db.Close)
	require.NoError(t, testutil.WaitForCondition(ctx, 60*time.Second, 500*time.Millisecond, func() error {
		return db.Ping(ctx)
	}))

	return db
}

func startHTTPRedisClient(t *testing.T, ctx context.Context) *redis.Client {
	t.Helper()

	container := testutil.StartDockerContainer(t, ctx, testutil.DockerRunRequest{
		NamePrefix:   "xdrop-http-redis",
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

func startHTTPStorage(t *testing.T, ctx context.Context) (*storage.S3Storage, config.Config) {
	t.Helper()

	container := testutil.StartDockerContainer(t, ctx, testutil.DockerRunRequest{
		NamePrefix: "xdrop-http-minio",
		Image:      "minio/minio:latest",
		Env: map[string]string{
			"MINIO_ROOT_USER":     "minioadmin",
			"MINIO_ROOT_PASSWORD": "minioadmin",
		},
		ExposedPorts: []string{"9000/tcp"},
		Command:      []string{"server", "/data"},
	})

	endpoint := fmt.Sprintf("http://127.0.0.1:%s", container.PublishedPort(t, ctx, "9000/tcp"))
	require.NoError(t, testutil.WaitForCondition(ctx, 90*time.Second, 500*time.Millisecond, func() error {
		response, err := nethttp.Get(endpoint + "/minio/health/live")
		if err != nil {
			return err
		}
		defer response.Body.Close()
		if response.StatusCode >= 400 {
			return fmt.Errorf("minio returned status %d", response.StatusCode)
		}
		return nil
	}))
	objectStorage, err := storage.NewS3Storage(ctx, storage.Config{
		Endpoint:       endpoint,
		PublicEndpoint: endpoint,
		Region:         "us-east-1",
		Bucket:         "xdrop",
		AccessKey:      "minioadmin",
		SecretKey:      "minioadmin",
	})
	require.NoError(t, err)
	require.NoError(t, objectStorage.EnsureBucket(ctx))

	cfg := config.Config{
		AllowedOrigins:   []string{"http://localhost:5173"},
		ChunkSize:        8 * 1024 * 1024,
		DefaultExpiry:    time.Hour,
		CreateLimit:      20,
		PublicReadLimit:  120,
		DownloadURLLimit: 120,
		PresignTTL:       5 * time.Minute,
		MaxFileCount:     100,
		MaxTransferBytes: 256 * 1024 * 1024,
	}

	return objectStorage, cfg
}

func doJSON(t *testing.T, client *nethttp.Client, method string, url string, bearerToken string, payload any, target any) {
	t.Helper()

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		require.NoError(t, err)
		body = bytes.NewReader(encoded)
	}

	request, err := nethttp.NewRequest(method, url, body)
	require.NoError(t, err)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearerToken != "" {
		request.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	response, err := client.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.Less(t, response.StatusCode, 400, string(responseBody))

	if target != nil {
		require.NoError(t, json.Unmarshal(responseBody, target))
	}
}

func skipIfDockerUnavailable(t *testing.T) {
	t.Helper()
	testutil.SkipIfDockerUnavailable(t, true)
}
