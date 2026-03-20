package http

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	nethttp "net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/models"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/service"
)

func TestCreateTransferRateLimitUsesIPAddressWithoutPort(t *testing.T) {
	t.Parallel()

	cfg := testRouterConfig()
	cfg.CreateLimit = 1

	router := NewRouter(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		service.New(cfg, newRouterRepository(), &routerStorage{}, ratelimit.NewMemoryLimiter()),
	)

	first := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, first.Code)

	second := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40002")
	require.Equal(t, nethttp.StatusTooManyRequests, second.Code)
	require.Contains(t, second.Body.String(), `"error":"rate_limited"`)
}

func TestCreateTransferRejectsTrailingJSONPayload(t *testing.T) {
	t.Parallel()

	router := newTestRouter()
	response := performJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/",
		`{"expiresInSeconds":3600}{"ignored":true}`,
		"198.51.100.42:40001",
	)

	require.Equal(t, nethttp.StatusBadRequest, response.Code)
	require.Contains(t, response.Body.String(), `"error":"invalid_json"`)
}

func TestCreateTransferRejectsUnknownFields(t *testing.T) {
	t.Parallel()

	router := newTestRouter()
	response := performJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/",
		`{"expiresInSeconds":3600,"extra":true}`,
		"198.51.100.42:40001",
	)

	require.Equal(t, nethttp.StatusBadRequest, response.Code)
	require.Contains(t, response.Body.String(), `"error":"invalid_json"`)
}

func TestHealthzAppliesSecurityHeaders(t *testing.T) {
	t.Parallel()

	router := newTestRouter()
	request := httptest.NewRequest(nethttp.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	require.Equal(t, nethttp.StatusOK, response.Code)
	require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
	require.Equal(t, "DENY", response.Header().Get("X-Frame-Options"))
	require.Equal(t, "same-origin", response.Header().Get("Cross-Origin-Opener-Policy"))
}

func newTestRouter() nethttp.Handler {
	cfg := testRouterConfig()
	return NewRouter(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		service.New(cfg, newRouterRepository(), &routerStorage{}, ratelimit.NewMemoryLimiter()),
	)
}

func testRouterConfig() config.Config {
	return config.Config{
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
}

func performJSONRequest(t *testing.T, handler nethttp.Handler, method string, path string, body string, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = remoteAddr

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	return response
}

type routerRepository struct {
	transfers map[string]models.Transfer
	files     map[string][]models.TransferFile
	chunks    map[string][]models.TransferChunk
}

func newRouterRepository() *routerRepository {
	return &routerRepository{
		transfers: map[string]models.Transfer{},
		files:     map[string][]models.TransferFile{},
		chunks:    map[string][]models.TransferChunk{},
	}
}

func (r *routerRepository) CreateTransfer(_ context.Context, transfer models.Transfer) error {
	r.transfers[transfer.ID] = transfer
	return nil
}

func (r *routerRepository) GetTransfer(_ context.Context, transferID string) (models.Transfer, error) {
	transfer, ok := r.transfers[transferID]
	if !ok {
		return models.Transfer{}, repo.ErrNotFound
	}
	return transfer, nil
}

func (r *routerRepository) RegisterFiles(_ context.Context, transferID string, files []models.TransferFile) error {
	r.files[transferID] = append([]models.TransferFile{}, files...)
	transfer := r.transfers[transferID]
	transfer.Status = models.TransferStatusUploading
	r.transfers[transferID] = transfer
	return nil
}

func (r *routerRepository) ListFiles(_ context.Context, transferID string) ([]models.TransferFile, error) {
	return append([]models.TransferFile{}, r.files[transferID]...), nil
}

func (r *routerRepository) CompleteChunks(_ context.Context, transferID string, chunks []models.TransferChunk) error {
	r.chunks[transferID] = append(r.chunks[transferID], chunks...)
	files := r.files[transferID]
	for fileIndex := range files {
		uploaded := 0
		for _, chunk := range r.chunks[transferID] {
			if chunk.OpaqueFileID == files[fileIndex].OpaqueFileID {
				uploaded++
			}
		}
		if uploaded >= files[fileIndex].TotalChunks {
			files[fileIndex].UploadStatus = "complete"
		}
	}
	r.files[transferID] = files
	return nil
}

func (r *routerRepository) GetResumeState(ctx context.Context, transferID string) (models.TransferResumeState, error) {
	transfer, err := r.GetTransfer(ctx, transferID)
	if err != nil {
		return models.TransferResumeState{}, err
	}

	uploaded := map[string][]int{}
	for _, chunk := range r.chunks[transferID] {
		uploaded[chunk.OpaqueFileID] = append(uploaded[chunk.OpaqueFileID], chunk.ChunkIndex)
	}

	return models.TransferResumeState{
		Transfer:       transfer,
		Files:          append([]models.TransferFile{}, r.files[transferID]...),
		UploadedChunks: uploaded,
	}, nil
}

func (r *routerRepository) SetManifest(_ context.Context, transferID string, objectKey string, ciphertextSize int64) error {
	transfer := r.transfers[transferID]
	transfer.ManifestObjectKey = objectKey
	transfer.ManifestCiphertextSize = ciphertextSize
	r.transfers[transferID] = transfer
	return nil
}

func (r *routerRepository) FinalizeTransfer(_ context.Context, transferID string, wrappedRootKey string, totalFiles int, totalCiphertextBytes int64) error {
	transfer := r.transfers[transferID]
	transfer.Status = models.TransferStatusReady
	transfer.WrappedRootKey = wrappedRootKey
	transfer.TotalFiles = totalFiles
	transfer.TotalCiphertextBytes = totalCiphertextBytes
	now := time.Now().UTC()
	transfer.FinalizedAt = &now
	r.transfers[transferID] = transfer
	return nil
}

func (r *routerRepository) UpdateTransfer(_ context.Context, transferID string, params models.UpdateTransferParams) error {
	transfer := r.transfers[transferID]
	if params.ManifestObjectKey != nil {
		transfer.ManifestObjectKey = *params.ManifestObjectKey
	}
	if params.ExpiresAt != nil {
		transfer.ExpiresAt = *params.ExpiresAt
	}
	if params.ManifestCiphertextSize != nil {
		transfer.ManifestCiphertextSize = *params.ManifestCiphertextSize
	}
	r.transfers[transferID] = transfer
	return nil
}

func (r *routerRepository) MarkDeleted(_ context.Context, transferID string) error {
	transfer := r.transfers[transferID]
	now := time.Now().UTC()
	transfer.Status = models.TransferStatusDeleted
	transfer.DeletedAt = &now
	r.transfers[transferID] = transfer
	return nil
}

func (r *routerRepository) ListCleanupCandidates(context.Context, int) ([]models.Transfer, error) {
	return nil, nil
}

func (r *routerRepository) MarkPurged(context.Context, string) error {
	return nil
}

type routerStorage struct{}

func (s *routerStorage) PresignUpload(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	return "https://example.test/upload/" + objectKey, nil
}

func (s *routerStorage) PresignDownload(_ context.Context, objectKey string, _ time.Duration) (string, error) {
	return "https://example.test/download/" + objectKey, nil
}

func (s *routerStorage) PutObject(context.Context, string, []byte, string) error {
	return nil
}

func (s *routerStorage) DeletePrefix(context.Context, string) error {
	return nil
}

func (s *routerStorage) EnsureBucket(context.Context) error {
	return nil
}

func TestManageTransferEndpointsLifecycle(t *testing.T) {
	t.Parallel()

	router, repository := newTestRouterWithRepository()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	create := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, create.Code)
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &createResponse))

	getResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodGet,
		"/api/v1/transfers/"+createResponse.TransferID+"/",
		createResponse.ManageToken,
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, getResponse.Code)
	require.Contains(t, getResponse.Body.String(), createResponse.TransferID)

	patchBody := `{"ciphertextBase64":"` + base64.StdEncoding.EncodeToString([]byte("updated-manifest")) + `"}`
	patchResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPatch,
		"/api/v1/transfers/"+createResponse.TransferID+"/",
		createResponse.ManageToken,
		patchBody,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, patchResponse.Code)

	updatedTransfer, err := repository.GetTransfer(context.Background(), createResponse.TransferID)
	require.NoError(t, err)
	require.Equal(t, "transfers/"+createResponse.TransferID+"/manifest.bin", updatedTransfer.ManifestObjectKey)
	require.Equal(t, int64(len("updated-manifest")), updatedTransfer.ManifestCiphertextSize)

	resumeResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodGet,
		"/api/v1/transfers/"+createResponse.TransferID+"/resume",
		createResponse.ManageToken,
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, resumeResponse.Code)
	require.Contains(t, resumeResponse.Body.String(), createResponse.TransferID)

	deleteResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodDelete,
		"/api/v1/transfers/"+createResponse.TransferID+"/",
		createResponse.ManageToken,
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusNoContent, deleteResponse.Code)

	deletedTransfer, err := repository.GetTransfer(context.Background(), createResponse.TransferID)
	require.NoError(t, err)
	require.Equal(t, models.TransferStatusDeleted, deletedTransfer.Status)
	require.NotNil(t, deletedTransfer.DeletedAt)
}

func TestTransferLifecycleEndpointsWithInMemoryDependencies(t *testing.T) {
	t.Parallel()

	router := newTestRouter()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	create := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, create.Code)
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &createResponse))

	register := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/"+createResponse.TransferID+"/files",
		createResponse.ManageToken,
		`[{"fileId":"file-a","totalChunks":2,"ciphertextBytes":64,"plaintextBytes":32,"chunkSize":32}]`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, register.Code)

	uploadURLs := struct {
		Items []struct {
			FileID     string `json:"fileId"`
			ChunkIndex int    `json:"chunkIndex"`
			ObjectKey  string `json:"objectKey"`
			URL        string `json:"url"`
		} `json:"items"`
	}{}
	createUploads := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/"+createResponse.TransferID+"/upload-urls",
		createResponse.ManageToken,
		`{"chunks":[{"fileId":"file-a","chunkIndex":0},{"fileId":"file-a","chunkIndex":1}]}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, createUploads.Code)
	require.NoError(t, json.Unmarshal(createUploads.Body.Bytes(), &uploadURLs))
	require.Len(t, uploadURLs.Items, 2)
	require.Contains(t, uploadURLs.Items[0].URL, uploadURLs.Items[0].ObjectKey)

	complete := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/"+createResponse.TransferID+"/chunks/complete",
		createResponse.ManageToken,
		`[{"fileId":"file-a","chunkIndex":0,"ciphertextSize":32,"checksumSha256":"a"},{"fileId":"file-a","chunkIndex":1,"ciphertextSize":32,"checksumSha256":"b"}]`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, complete.Code)

	putManifest := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/"+createResponse.TransferID+"/manifest",
		createResponse.ManageToken,
		`{"ciphertextBase64":"`+base64.StdEncoding.EncodeToString([]byte("manifest"))+`"}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, putManifest.Code)

	finalize := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/transfers/"+createResponse.TransferID+"/finalize",
		createResponse.ManageToken,
		`{"wrappedRootKey":"wrapped","totalFiles":1,"totalCiphertextBytes":64}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, finalize.Code)

	publicTransfer := struct {
		Status         string `json:"status"`
		ManifestURL    string `json:"manifestUrl"`
		WrappedRootKey string `json:"wrappedRootKey"`
	}{}
	getPublic := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodGet,
		"/api/v1/public/transfers/"+createResponse.TransferID+"/",
		"",
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, getPublic.Code)
	require.NoError(t, json.Unmarshal(getPublic.Body.Bytes(), &publicTransfer))
	require.Equal(t, "ready", publicTransfer.Status)
	require.Contains(t, publicTransfer.ManifestURL, "transfers/"+createResponse.TransferID+"/manifest.bin")
	require.Equal(t, "wrapped", publicTransfer.WrappedRootKey)

	downloadURLs := struct {
		Items []struct {
			FileID     string `json:"fileId"`
			ChunkIndex int    `json:"chunkIndex"`
			URL        string `json:"url"`
		} `json:"items"`
	}{}
	createDownloads := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/public/transfers/"+createResponse.TransferID+"/download-urls",
		"",
		`{"chunks":[{"fileId":"file-a","chunkIndex":1}]}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusOK, createDownloads.Code)
	require.NoError(t, json.Unmarshal(createDownloads.Body.Bytes(), &downloadURLs))
	require.Len(t, downloadURLs.Items, 1)
	require.Contains(t, downloadURLs.Items[0].URL, "transfers/"+createResponse.TransferID+"/files/file-a/chunks/00000001.bin")
}

func TestManageTransferEndpointsRejectInvalidPayloadsAndMissingTokens(t *testing.T) {
	t.Parallel()

	router := newTestRouter()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	create := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, create.Code)
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &createResponse))

	patchResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPatch,
		"/api/v1/transfers/"+createResponse.TransferID+"/",
		createResponse.ManageToken,
		`{"expiresInSeconds":3600}{"extra":true}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusBadRequest, patchResponse.Code)
	require.Contains(t, patchResponse.Body.String(), `"error":"invalid_json"`)

	getResponse := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodGet,
		"/api/v1/transfers/"+createResponse.TransferID+"/",
		"",
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusUnauthorized, getResponse.Code)
	require.Contains(t, getResponse.Body.String(), `"error":"missing_manage_token"`)
}

func TestTransferEndpointsRejectInvalidJSON(t *testing.T) {
	t.Parallel()

	router := newTestRouter()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	create := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, create.Code)
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &createResponse))

	testCases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "register files", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/files", body: `{"broken":true}`},
		{name: "create upload urls", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/upload-urls", body: `{"chunks":"broken"}`},
		{name: "complete chunks", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/chunks/complete", body: `{"broken":true}`},
		{name: "put manifest", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/manifest", body: `{"ciphertextBase64":123}`},
		{name: "finalize", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/finalize", body: `{"wrappedRootKey":123}`},
		{name: "download urls", method: nethttp.MethodPost, path: "/api/v1/public/transfers/" + createResponse.TransferID + "/download-urls", body: `{"chunks":"broken"}`},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			bearer := createResponse.ManageToken
			if tc.name == "download urls" {
				bearer = ""
			}
			response := performAuthorizedJSONRequest(t, router, tc.method, tc.path, bearer, tc.body, "198.51.100.42:40001")
			require.Equal(t, nethttp.StatusBadRequest, response.Code)
			require.Contains(t, response.Body.String(), `"error":"invalid_json"`)
		})
	}
}

func TestTransferEndpointsSurfaceServiceErrors(t *testing.T) {
	t.Parallel()

	router := newTestRouter()

	createResponse := struct {
		TransferID  string `json:"transferId"`
		ManageToken string `json:"manageToken"`
	}{}
	create := performJSONRequest(t, router, nethttp.MethodPost, "/api/v1/transfers/", `{"expiresInSeconds":3600}`, "198.51.100.42:40001")
	require.Equal(t, nethttp.StatusCreated, create.Code)
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &createResponse))

	managePaths := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "register files", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/files", body: `[{"fileId":"file-a","totalChunks":1,"ciphertextBytes":32,"chunkSize":32}]`},
		{name: "create upload urls", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/upload-urls", body: `{"chunks":[{"fileId":"file-a","chunkIndex":0}]}`},
		{name: "complete chunks", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/chunks/complete", body: `[{"fileId":"file-a","chunkIndex":0,"ciphertextSize":32,"checksumSha256":"a"}]`},
		{name: "put manifest", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/manifest", body: `{"ciphertextBase64":"` + base64.StdEncoding.EncodeToString([]byte("manifest")) + `"}`},
		{name: "finalize", method: nethttp.MethodPost, path: "/api/v1/transfers/" + createResponse.TransferID + "/finalize", body: `{"wrappedRootKey":"wrapped","totalFiles":1,"totalCiphertextBytes":64}`},
		{name: "delete transfer", method: nethttp.MethodDelete, path: "/api/v1/transfers/" + createResponse.TransferID + "/", body: ``},
		{name: "resume transfer", method: nethttp.MethodGet, path: "/api/v1/transfers/" + createResponse.TransferID + "/resume", body: ``},
	}

	for _, tc := range managePaths {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			response := performAuthorizedJSONRequest(t, router, tc.method, tc.path, "", tc.body, "198.51.100.42:40001")
			require.Equal(t, nethttp.StatusUnauthorized, response.Code)
			require.Contains(t, response.Body.String(), `"error":"missing_manage_token"`)
		})
	}

	getPublic := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodGet,
		"/api/v1/public/transfers/missing-transfer/",
		"",
		"",
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusNotFound, getPublic.Code)
	require.Contains(t, getPublic.Body.String(), `"error":"not_found"`)

	createDownloads := performAuthorizedJSONRequest(
		t,
		router,
		nethttp.MethodPost,
		"/api/v1/public/transfers/missing-transfer/download-urls",
		"",
		`{"chunks":[{"fileId":"file-a","chunkIndex":0}]}`,
		"198.51.100.42:40001",
	)
	require.Equal(t, nethttp.StatusNotFound, createDownloads.Code)
	require.Contains(t, createDownloads.Body.String(), `"error":"not_found"`)
}

func TestWriteErrorAndHeaderHelpers(t *testing.T) {
	t.Parallel()

	t.Run("write error handles generic failures", func(t *testing.T) {
		t.Parallel()

		response := httptest.NewRecorder()
		writeError(response, errors.New("boom"))

		require.Equal(t, nethttp.StatusInternalServerError, response.Code)
		require.Contains(t, response.Body.String(), `"error":"internal_error"`)
	})

	t.Run("bearer token trims and validates prefixes", func(t *testing.T) {
		t.Parallel()

		request := httptest.NewRequest(nethttp.MethodGet, "/healthz", nil)
		request.Header.Set("Authorization", "  Bearer test-token  ")
		require.Equal(t, "test-token", bearerToken(request))

		request.Header.Set("Authorization", "Token test-token")
		require.Empty(t, bearerToken(request))
	})

	t.Run("client key handles empty, hostport and raw values", func(t *testing.T) {
		t.Parallel()

		request := httptest.NewRequest(nethttp.MethodGet, "/healthz", nil)
		request.RemoteAddr = "198.51.100.42:41000"
		require.Equal(t, "198.51.100.42", clientKey(request))

		request.RemoteAddr = "198.51.100.42"
		require.Equal(t, "198.51.100.42", clientKey(request))

		request.RemoteAddr = ""
		require.Empty(t, clientKey(request))
	})
}

func newTestRouterWithRepository() (nethttp.Handler, *routerRepository) {
	cfg := testRouterConfig()
	repository := newRouterRepository()
	router := NewRouter(
		cfg,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		service.New(cfg, repository, &routerStorage{}, ratelimit.NewMemoryLimiter()),
	)
	return router, repository
}

func performAuthorizedJSONRequest(t *testing.T, handler nethttp.Handler, method string, path string, bearer string, body string, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()

	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	request.RemoteAddr = remoteAddr

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	return response
}
