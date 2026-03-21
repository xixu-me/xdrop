package storage

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestS3StorageLifecycleAgainstMinIO(t *testing.T) {
	skipIfDockerUnavailable(t)

	ctx := context.Background()
	cfg := startMinIOConfig(t, ctx)

	store, err := NewS3Storage(ctx, cfg)
	require.NoError(t, err)

	require.NoError(t, store.EnsureBucket(ctx))
	require.NoError(t, store.EnsureBucket(ctx))

	require.NoError(t, store.PutObject(ctx, "transfers/demo/manifest.bin", []byte("manifest"), "application/octet-stream"))
	require.NoError(t, store.PutObject(ctx, "transfers/demo/files/file-a/chunks/00000000.bin", []byte("chunk"), "application/octet-stream"))
	require.NoError(t, store.PutObject(ctx, "transfers/other/manifest.bin", []byte("other"), "application/octet-stream"))

	objectBody := getObjectBody(t, ctx, store, "transfers/demo/manifest.bin")
	require.Equal(t, []byte("manifest"), objectBody)

	uploadURL, err := store.PresignUpload(ctx, "transfers/demo/files/file-a/chunks/00000001.bin", 5*time.Minute)
	require.NoError(t, err)
	require.Contains(t, uploadURL, "X-Amz-Algorithm=")
	require.Contains(t, uploadURL, "X-Amz-Signature=")
	require.Contains(t, uploadURL, cfg.PublicEndpoint)

	downloadURL, err := store.PresignDownload(ctx, "transfers/demo/manifest.bin", 5*time.Minute)
	require.NoError(t, err)
	require.Contains(t, downloadURL, "X-Amz-Algorithm=")
	require.Contains(t, downloadURL, cfg.PublicEndpoint)

	require.NoError(t, store.DeletePrefix(ctx, "transfers/demo/"))

	keys := listObjectKeys(t, ctx, store)
	require.NotContains(t, keys, "transfers/demo/manifest.bin")
	require.NotContains(t, keys, "transfers/demo/files/file-a/chunks/00000000.bin")
	require.Contains(t, keys, "transfers/other/manifest.bin")
}

func TestNormalizeEndpointHandlesSchemeAndWhitespace(t *testing.T) {
	t.Parallel()

	normalized, err := NormalizeEndpoint(" localhost:9000 ")
	require.NoError(t, err)
	require.Equal(t, "http://localhost:9000", normalized)

	normalized, err = NormalizeEndpoint("https://minio.example.test")
	require.NoError(t, err)
	require.Equal(t, "https://minio.example.test", normalized)
}

func TestNormalizeEndpointRejectsInvalidURL(t *testing.T) {
	t.Parallel()

	_, err := NormalizeEndpoint("http://%zz")
	require.Error(t, err)
}

func TestReadAllReadsEntireStream(t *testing.T) {
	t.Parallel()

	body, err := ReadAll(strings.NewReader("hello"))
	require.NoError(t, err)
	require.Equal(t, []byte("hello"), body)
}

func startMinIOConfig(t *testing.T, ctx context.Context) Config {
	t.Helper()

	container, err := testcontainers.Run(
		ctx,
		"minio/minio:latest",
		testcontainers.WithEnv(map[string]string{
			"MINIO_ROOT_USER":     "minioadmin",
			"MINIO_ROOT_PASSWORD": "minioadmin",
		}),
		testcontainers.WithExposedPorts("9000/tcp"),
		testcontainers.WithCmd("server", "/data"),
		testcontainers.WithWaitStrategy(
			wait.ForHTTP("/minio/health/live").
				WithPort("9000/tcp").
				WithStartupTimeout(90*time.Second),
		),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, testcontainers.TerminateContainer(container))
	})

	host, err := container.Host(ctx)
	require.NoError(t, err)
	port, err := container.MappedPort(ctx, "9000/tcp")
	require.NoError(t, err)

	internalEndpoint := fmt.Sprintf("http://%s:%s", host, port.Port())
	return Config{
		Endpoint:       internalEndpoint,
		PublicEndpoint: "http://public.example.test:9000",
		Region:         "us-east-1",
		Bucket:         "xdrop",
		AccessKey:      "minioadmin",
		SecretKey:      "minioadmin",
	}
}

func getObjectBody(t *testing.T, ctx context.Context, store *S3Storage, objectKey string) []byte {
	t.Helper()

	response, err := store.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(store.bucket),
		Key:    aws.String(objectKey),
	})
	require.NoError(t, err)
	defer response.Body.Close()

	body, err := ReadAll(response.Body)
	require.NoError(t, err)
	return body
}

func listObjectKeys(t *testing.T, ctx context.Context, store *S3Storage) []string {
	t.Helper()

	paginator := s3.NewListObjectsV2Paginator(store.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(store.bucket),
	})

	keys := []string{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		require.NoError(t, err)
		for _, item := range page.Contents {
			if item.Key != nil {
				keys = append(keys, *item.Key)
			}
		}
	}

	return keys
}

func skipIfDockerUnavailable(t *testing.T) {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping docker-backed integration test in short mode")
	}
	if runtime.GOOS == "windows" {
		t.Skip("skipping docker-backed integration test on windows")
	}

	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skipf("skipping docker-backed integration test: %v", err)
	}
}
