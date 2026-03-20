package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xdrop/monorepo/internal/config"
	"github.com/xdrop/monorepo/internal/models"
	"github.com/xdrop/monorepo/internal/ratelimit"
	"github.com/xdrop/monorepo/internal/repo"
	"github.com/xdrop/monorepo/internal/storage"
)

var readRandom = rand.Read

// Service coordinates transfer lifecycle rules across storage, persistence, and rate limits.
type Service struct {
	cfg     config.Config
	repo    repo.Repository
	storage storage.ObjectStorage
	limiter ratelimit.Limiter
}

// New builds the application service with its persistence, storage, and rate-limit dependencies.
func New(cfg config.Config, repository repo.Repository, objectStorage storage.ObjectStorage, limiter ratelimit.Limiter) *Service {
	return &Service{
		cfg:     cfg,
		repo:    repository,
		storage: objectStorage,
		limiter: limiter,
	}
}

// UploadConfig advertises browser upload constraints derived from server policy.
type UploadConfig struct {
	ChunkSize        int64 `json:"chunkSize"`
	MaxParallel      int   `json:"maxParallel"`
	MaxFileCount     int   `json:"maxFileCount"`
	MaxTransferBytes int64 `json:"maxTransferBytes"`
}

// CreateTransferRequest starts a new transfer with a supported expiry option.
type CreateTransferRequest struct {
	ExpiresInSeconds int `json:"expiresInSeconds"`
	ExpiresInDays    int `json:"expiresInDays,omitempty"`
}

// CreateTransferResponse returns the transfer handle, manage token, and upload limits.
type CreateTransferResponse struct {
	TransferID   string       `json:"transferId"`
	ManageToken  string       `json:"manageToken"`
	UploadConfig UploadConfig `json:"uploadConfig"`
	ExpiresAt    time.Time    `json:"expiresAt"`
}

// RegisterFileRequest describes one encrypted file before chunk upload begins.
type RegisterFileRequest struct {
	FileID          string `json:"fileId"`
	TotalChunks     int    `json:"totalChunks"`
	CiphertextBytes int64  `json:"ciphertextBytes"`
	PlaintextBytes  *int64 `json:"plaintextBytes"`
	ChunkSize       int64  `json:"chunkSize"`
}

// UploadURLRequest asks the server to presign upload URLs for a batch of chunks.
type UploadURLRequest struct {
	Chunks []UploadChunkRequest `json:"chunks"`
}

// UploadChunkRequest identifies one chunk within a file.
type UploadChunkRequest struct {
	FileID     string `json:"fileId"`
	ChunkIndex int    `json:"chunkIndex"`
}

// UploadURLItem contains the storage coordinates for an uploadable chunk.
type UploadURLItem struct {
	FileID     string `json:"fileId"`
	ChunkIndex int    `json:"chunkIndex"`
	ObjectKey  string `json:"objectKey"`
	URL        string `json:"url"`
}

// CompleteChunkRequest records a successfully uploaded chunk and its checksum.
type CompleteChunkRequest struct {
	FileID         string `json:"fileId"`
	ChunkIndex     int    `json:"chunkIndex"`
	CiphertextSize int64  `json:"ciphertextSize"`
	ChecksumSHA256 string `json:"checksumSha256"`
}

// ManifestUploadRequest uploads the encrypted manifest envelope as base64 text.
type ManifestUploadRequest struct {
	CiphertextBase64 string `json:"ciphertextBase64"`
}

// FinalizeTransferRequest promotes a complete upload into a downloadable transfer.
type FinalizeTransferRequest struct {
	WrappedRootKey       string `json:"wrappedRootKey"`
	TotalFiles           int    `json:"totalFiles"`
	TotalCiphertextBytes int64  `json:"totalCiphertextBytes"`
}

// UpdateTransferRequest describes the mutable parts of a transfer after creation.
type UpdateTransferRequest struct {
	ExpiresInSeconds *int   `json:"expiresInSeconds"`
	ExpiresInDays    *int   `json:"expiresInDays,omitempty"`
	CiphertextBase64 string `json:"ciphertextBase64"`
}

// ManageTransferResponse exposes resume and management state to the transfer owner.
type ManageTransferResponse struct {
	ID                     string                `json:"id"`
	Status                 models.TransferStatus `json:"status"`
	ExpiresAt              time.Time             `json:"expiresAt"`
	CreatedAt              time.Time             `json:"createdAt"`
	UpdatedAt              time.Time             `json:"updatedAt"`
	FinalizedAt            *time.Time            `json:"finalizedAt,omitempty"`
	ManifestCiphertextSize int64                 `json:"manifestCiphertextSize"`
	TotalFiles             int                   `json:"totalFiles"`
	TotalCiphertextBytes   int64                 `json:"totalCiphertextBytes"`
	Files                  []ManageTransferFile  `json:"files"`
	UploadedChunks         map[string][]int      `json:"uploadedChunks,omitempty"`
}

// ManageTransferFile reports per-file upload progress for the owner view.
type ManageTransferFile struct {
	FileID          string `json:"fileId"`
	TotalChunks     int    `json:"totalChunks"`
	CiphertextBytes int64  `json:"ciphertextBytes"`
	ChunkSize       int64  `json:"chunkSize"`
	UploadStatus    string `json:"uploadStatus"`
}

// PublicTransferResponse exposes the public download state without revealing manage controls.
type PublicTransferResponse struct {
	ID                     string               `json:"id"`
	Status                 string               `json:"status"`
	ExpiresAt              time.Time            `json:"expiresAt"`
	WrappedRootKey         string               `json:"wrappedRootKey,omitempty"`
	ManifestURL            string               `json:"manifestUrl,omitempty"`
	ManifestCiphertextSize int64                `json:"manifestCiphertextSize,omitempty"`
	DownloadConfig         PublicDownloadConfig `json:"downloadConfig,omitempty"`
}

// PublicDownloadConfig advertises public download behavior that the client should honor.
type PublicDownloadConfig struct {
	PresignTTLSeconds int `json:"presignTtlSeconds"`
}

// DownloadURLRequest asks for download URLs for specific uploaded chunks.
type DownloadURLRequest struct {
	Chunks []UploadChunkRequest `json:"chunks"`
}

// DownloadURLItem returns a public download URL for one chunk.
type DownloadURLItem struct {
	FileID     string `json:"fileId"`
	ChunkIndex int    `json:"chunkIndex"`
	URL        string `json:"url"`
}

// HTTPError carries an HTTP status and machine-readable API code through the service layer.
type HTTPError struct {
	Status  int
	Code    string
	Message string
}

func (e *HTTPError) Error() string {
	return e.Message
}

// CreateTransfer creates a draft transfer and returns its manage token and upload policy.
func (s *Service) CreateTransfer(ctx context.Context, clientKey string, request CreateTransferRequest) (CreateTransferResponse, error) {
	if err := s.enforceRateLimit(ctx, "create:"+clientKey, s.cfg.CreateLimit, time.Hour); err != nil {
		return CreateTransferResponse{}, err
	}

	expiryDuration, err := requestedCreateExpiry(request, s.cfg.DefaultExpiry)
	if err != nil {
		return CreateTransferResponse{}, err
	}

	transferID, err := randomToken(18)
	if err != nil {
		return CreateTransferResponse{}, fmt.Errorf("generate transfer id: %w", err)
	}
	manageToken, err := randomToken(32)
	if err != nil {
		return CreateTransferResponse{}, fmt.Errorf("generate manage token: %w", err)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(expiryDuration)
	transfer := models.Transfer{
		ID:              transferID,
		Status:          models.TransferStatusDraft,
		ExpiresAt:       expiresAt,
		CreatedAt:       now,
		UpdatedAt:       now,
		ManageTokenHash: hashToken(manageToken),
	}

	if err := s.repo.CreateTransfer(ctx, transfer); err != nil {
		return CreateTransferResponse{}, fmt.Errorf("create transfer: %w", err)
	}

	return CreateTransferResponse{
		TransferID:  transferID,
		ManageToken: manageToken,
		UploadConfig: UploadConfig{
			ChunkSize:        s.cfg.ChunkSize,
			MaxParallel:      6,
			MaxFileCount:     s.cfg.MaxFileCount,
			MaxTransferBytes: s.cfg.MaxTransferBytes,
		},
		ExpiresAt: expiresAt,
	}, nil
}

// RegisterFiles validates encrypted file metadata before upload URLs are issued.
func (s *Service) RegisterFiles(ctx context.Context, transferID string, token string, files []RegisterFileRequest) error {
	if len(files) == 0 {
		return &HTTPError{Status: 400, Code: "empty_files", Message: "at least one file must be registered"}
	}
	if len(files) > s.cfg.MaxFileCount {
		return &HTTPError{Status: 400, Code: "too_many_files", Message: "file count exceeds configured maximum"}
	}

	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return err
	}
	if isExpired(transfer) {
		return &HTTPError{Status: 410, Code: "expired", Message: "transfer has expired"}
	}

	totalBytes := int64(0)
	modelFiles := make([]models.TransferFile, 0, len(files))
	for _, file := range files {
		if strings.TrimSpace(file.FileID) == "" || file.TotalChunks <= 0 || file.ChunkSize <= 0 || file.CiphertextBytes <= 0 {
			return &HTTPError{Status: 400, Code: "invalid_file_registration", Message: "file registration contains invalid values"}
		}
		totalBytes += file.CiphertextBytes
		modelFiles = append(modelFiles, models.TransferFile{
			TransferID:      transferID,
			OpaqueFileID:    file.FileID,
			TotalChunks:     file.TotalChunks,
			CiphertextBytes: file.CiphertextBytes,
			PlaintextBytes:  file.PlaintextBytes,
			ChunkSize:       file.ChunkSize,
			UploadStatus:    "pending",
		})
	}

	if totalBytes > s.cfg.MaxTransferBytes {
		return &HTTPError{Status: 400, Code: "transfer_too_large", Message: "transfer exceeds configured size limit"}
	}

	if err := s.repo.RegisterFiles(ctx, transferID, modelFiles); err != nil {
		return fmt.Errorf("register files: %w", err)
	}

	return nil
}

// CreateUploadURLs presigns upload destinations for a managed transfer.
func (s *Service) CreateUploadURLs(ctx context.Context, transferID string, token string, request UploadURLRequest) ([]UploadURLItem, error) {
	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return nil, err
	}
	if isExpired(transfer) {
		return nil, &HTTPError{Status: 410, Code: "expired", Message: "transfer has expired"}
	}

	files, err := s.repo.ListFiles(ctx, transferID)
	if err != nil {
		return nil, fmt.Errorf("list files: %w", err)
	}
	fileIndex := map[string]models.TransferFile{}
	for _, file := range files {
		fileIndex[file.OpaqueFileID] = file
	}

	urls := make([]UploadURLItem, 0, len(request.Chunks))
	for _, chunk := range request.Chunks {
		file, ok := fileIndex[chunk.FileID]
		if !ok || chunk.ChunkIndex < 0 || chunk.ChunkIndex >= file.TotalChunks {
			return nil, &HTTPError{Status: 400, Code: "invalid_chunk_request", Message: "upload chunk request is invalid"}
		}

		objectKey := chunkObjectKey(transferID, chunk.FileID, chunk.ChunkIndex)
		url, err := s.storage.PresignUpload(ctx, objectKey, s.cfg.PresignTTL)
		if err != nil {
			return nil, fmt.Errorf("presign upload %s/%d: %w", chunk.FileID, chunk.ChunkIndex, err)
		}

		urls = append(urls, UploadURLItem{
			FileID:     chunk.FileID,
			ChunkIndex: chunk.ChunkIndex,
			ObjectKey:  objectKey,
			URL:        url,
		})
	}

	return urls, nil
}

// CompleteChunks records uploaded chunk metadata for resume and integrity checks.
func (s *Service) CompleteChunks(ctx context.Context, transferID string, token string, chunks []CompleteChunkRequest) error {
	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return err
	}
	if isExpired(transfer) {
		return &HTTPError{Status: 410, Code: "expired", Message: "transfer has expired"}
	}

	modelChunks := make([]models.TransferChunk, 0, len(chunks))
	for _, chunk := range chunks {
		if strings.TrimSpace(chunk.FileID) == "" || chunk.ChunkIndex < 0 || chunk.CiphertextSize <= 0 || strings.TrimSpace(chunk.ChecksumSHA256) == "" {
			return &HTTPError{Status: 400, Code: "invalid_chunk_completion", Message: "chunk completion payload is invalid"}
		}
		modelChunks = append(modelChunks, models.TransferChunk{
			TransferID:     transferID,
			OpaqueFileID:   chunk.FileID,
			ChunkIndex:     chunk.ChunkIndex,
			ObjectKey:      chunkObjectKey(transferID, chunk.FileID, chunk.ChunkIndex),
			CiphertextSize: chunk.CiphertextSize,
			ChecksumSHA256: chunk.ChecksumSHA256,
		})
	}

	if err := s.repo.CompleteChunks(ctx, transferID, modelChunks); err != nil {
		return fmt.Errorf("complete chunks: %w", err)
	}

	return nil
}

// PutManifest stores the encrypted manifest and records its object location.
func (s *Service) PutManifest(ctx context.Context, transferID string, token string, request ManifestUploadRequest) error {
	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return err
	}
	if isExpired(transfer) {
		return &HTTPError{Status: 410, Code: "expired", Message: "transfer has expired"}
	}

	payload, err := base64.StdEncoding.DecodeString(request.CiphertextBase64)
	if err != nil || len(payload) == 0 {
		return &HTTPError{Status: 400, Code: "invalid_manifest", Message: "manifest payload must be valid base64 ciphertext"}
	}

	objectKey := manifestObjectKey(transferID)
	if err := s.storage.PutObject(ctx, objectKey, payload, "application/octet-stream"); err != nil {
		return fmt.Errorf("put manifest: %w", err)
	}
	if err := s.repo.SetManifest(ctx, transferID, objectKey, int64(len(payload))); err != nil {
		return fmt.Errorf("set manifest: %w", err)
	}

	return nil
}

// FinalizeTransfer marks a fully uploaded transfer as ready for public downloads.
func (s *Service) FinalizeTransfer(ctx context.Context, transferID string, token string, request FinalizeTransferRequest) error {
	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return err
	}
	if isExpired(transfer) {
		return &HTTPError{Status: 410, Code: "expired", Message: "transfer has expired"}
	}
	if strings.TrimSpace(request.WrappedRootKey) == "" || request.TotalFiles <= 0 || request.TotalCiphertextBytes <= 0 {
		return &HTTPError{Status: 400, Code: "invalid_finalize", Message: "finalize payload is invalid"}
	}

	if err := s.repo.FinalizeTransfer(ctx, transferID, request.WrappedRootKey, request.TotalFiles, request.TotalCiphertextBytes); err != nil {
		return err
	}

	return nil
}

// GetManageTransfer returns owner-facing transfer state, including uploaded chunk indexes.
func (s *Service) GetManageTransfer(ctx context.Context, transferID string, token string) (ManageTransferResponse, error) {
	if _, err := s.authorizeManage(ctx, transferID, token); err != nil {
		return ManageTransferResponse{}, err
	}

	resume, err := s.repo.GetResumeState(ctx, transferID)
	if err != nil {
		return ManageTransferResponse{}, err
	}

	files := make([]ManageTransferFile, 0, len(resume.Files))
	for _, file := range resume.Files {
		files = append(files, ManageTransferFile{
			FileID:          file.OpaqueFileID,
			TotalChunks:     file.TotalChunks,
			CiphertextBytes: file.CiphertextBytes,
			ChunkSize:       file.ChunkSize,
			UploadStatus:    file.UploadStatus,
		})
	}

	return ManageTransferResponse{
		ID:                     resume.Transfer.ID,
		Status:                 publicStatus(resume.Transfer),
		ExpiresAt:              resume.Transfer.ExpiresAt,
		CreatedAt:              resume.Transfer.CreatedAt,
		UpdatedAt:              resume.Transfer.UpdatedAt,
		FinalizedAt:            resume.Transfer.FinalizedAt,
		ManifestCiphertextSize: resume.Transfer.ManifestCiphertextSize,
		TotalFiles:             resume.Transfer.TotalFiles,
		TotalCiphertextBytes:   resume.Transfer.TotalCiphertextBytes,
		Files:                  files,
		UploadedChunks:         resume.UploadedChunks,
	}, nil
}

// ResumeTransfer is an alias for GetManageTransfer used by the browser resume flow.
func (s *Service) ResumeTransfer(ctx context.Context, transferID string, token string) (ManageTransferResponse, error) {
	return s.GetManageTransfer(ctx, transferID, token)
}

// UpdateTransfer changes supported mutable fields such as expiry or manifest ciphertext.
func (s *Service) UpdateTransfer(ctx context.Context, transferID string, token string, request UpdateTransferRequest) error {
	transfer, err := s.authorizeManage(ctx, transferID, token)
	if err != nil {
		return err
	}
	if publicStatus(transfer) == models.TransferStatusDeleted {
		return &HTTPError{Status: 410, Code: "deleted", Message: "transfer has been deleted"}
	}

	params := models.UpdateTransferParams{}
	if expiryDuration, shouldUpdateExpiry, err := requestedUpdateExpiry(request); err != nil {
		return err
	} else if shouldUpdateExpiry {
		expiresAt := time.Now().UTC().Add(expiryDuration)
		params.ExpiresAt = &expiresAt
	}

	if strings.TrimSpace(request.CiphertextBase64) != "" {
		payload, err := base64.StdEncoding.DecodeString(request.CiphertextBase64)
		if err != nil || len(payload) == 0 {
			return &HTTPError{Status: 400, Code: "invalid_manifest", Message: "updated manifest must be valid base64 ciphertext"}
		}
		objectKey := transfer.ManifestObjectKey
		if objectKey == "" {
			objectKey = manifestObjectKey(transferID)
		}
		if err := s.storage.PutObject(ctx, objectKey, payload, "application/octet-stream"); err != nil {
			return fmt.Errorf("put updated manifest: %w", err)
		}
		params.ManifestObjectKey = &objectKey
		size := int64(len(payload))
		params.ManifestCiphertextSize = &size
	}

	if err := s.repo.UpdateTransfer(ctx, transferID, params); err != nil {
		return fmt.Errorf("update transfer: %w", err)
	}

	return nil
}

// DeleteTransfer tombstones a transfer and best-effort removes its remote objects.
func (s *Service) DeleteTransfer(ctx context.Context, transferID string, token string) error {
	if _, err := s.authorizeManage(ctx, transferID, token); err != nil {
		return err
	}

	if err := s.repo.MarkDeleted(ctx, transferID); err != nil {
		return fmt.Errorf("delete transfer: %w", err)
	}
	_ = s.storage.DeletePrefix(ctx, transferPrefix(transferID))

	return nil
}

// GetPublicTransfer returns the public download descriptor for recipients.
func (s *Service) GetPublicTransfer(ctx context.Context, clientKey string, transferID string) (PublicTransferResponse, error) {
	if err := s.enforceRateLimit(ctx, "public:"+clientKey+":"+transferID, s.cfg.PublicReadLimit, time.Minute); err != nil {
		return PublicTransferResponse{}, err
	}

	transfer, err := s.repo.GetTransfer(ctx, transferID)
	if errors.Is(err, repo.ErrNotFound) {
		return PublicTransferResponse{}, &HTTPError{Status: 404, Code: "not_found", Message: "transfer not found"}
	}
	if err != nil {
		return PublicTransferResponse{}, err
	}

	status := publicStatus(transfer)
	response := PublicTransferResponse{
		ID:        transfer.ID,
		Status:    string(status),
		ExpiresAt: transfer.ExpiresAt,
	}

	if status != models.TransferStatusReady {
		return response, nil
	}

	manifestURL, err := s.storage.PresignDownload(ctx, transfer.ManifestObjectKey, s.cfg.PresignTTL)
	if err != nil {
		return PublicTransferResponse{}, fmt.Errorf("presign manifest download: %w", err)
	}

	response.WrappedRootKey = transfer.WrappedRootKey
	response.ManifestURL = manifestURL
	response.ManifestCiphertextSize = transfer.ManifestCiphertextSize
	response.DownloadConfig = PublicDownloadConfig{PresignTTLSeconds: int(s.cfg.PresignTTL.Seconds())}

	return response, nil
}

// CreateDownloadURLs presigns recipient download URLs for chunks that actually exist.
func (s *Service) CreateDownloadURLs(ctx context.Context, clientKey string, transferID string, request DownloadURLRequest) ([]DownloadURLItem, error) {
	if err := s.enforceRateLimit(ctx, "download:"+clientKey+":"+transferID, s.cfg.DownloadURLLimit, time.Minute); err != nil {
		return nil, err
	}

	resume, err := s.repo.GetResumeState(ctx, transferID)
	if errors.Is(err, repo.ErrNotFound) {
		return nil, &HTTPError{Status: 404, Code: "not_found", Message: "transfer not found"}
	}
	if err != nil {
		return nil, err
	}
	if publicStatus(resume.Transfer) != models.TransferStatusReady {
		return nil, &HTTPError{Status: 409, Code: "transfer_unavailable", Message: "transfer is not available for download"}
	}

	uploaded := map[string]map[int]struct{}{}
	for fileID, chunks := range resume.UploadedChunks {
		uploaded[fileID] = map[int]struct{}{}
		for _, chunkIndex := range chunks {
			uploaded[fileID][chunkIndex] = struct{}{}
		}
	}

	urls := make([]DownloadURLItem, 0, len(request.Chunks))
	for _, chunk := range request.Chunks {
		chunkSet, ok := uploaded[chunk.FileID]
		if !ok {
			return nil, &HTTPError{Status: 400, Code: "invalid_download_request", Message: "requested file is unavailable"}
		}
		if _, ok = chunkSet[chunk.ChunkIndex]; !ok {
			return nil, &HTTPError{Status: 400, Code: "invalid_download_request", Message: "requested chunk is unavailable"}
		}

		url, err := s.storage.PresignDownload(ctx, chunkObjectKey(transferID, chunk.FileID, chunk.ChunkIndex), s.cfg.PresignTTL)
		if err != nil {
			return nil, fmt.Errorf("presign chunk download: %w", err)
		}
		urls = append(urls, DownloadURLItem{
			FileID:     chunk.FileID,
			ChunkIndex: chunk.ChunkIndex,
			URL:        url,
		})
	}

	return urls, nil
}

// CleanupExpired removes remote objects for expired or deleted transfers and marks them purged.
func (s *Service) CleanupExpired(ctx context.Context) error {
	transfers, err := s.repo.ListCleanupCandidates(ctx, 200)
	if err != nil {
		return fmt.Errorf("list cleanup candidates: %w", err)
	}

	for _, transfer := range transfers {
		if err := s.storage.DeletePrefix(ctx, transferPrefix(transfer.ID)); err != nil {
			return fmt.Errorf("delete transfer objects %s: %w", transfer.ID, err)
		}
		if err := s.repo.MarkPurged(ctx, transfer.ID); err != nil {
			return fmt.Errorf("mark purged %s: %w", transfer.ID, err)
		}
	}

	return nil
}

// authorizeManage validates the owner token using a constant-time hash comparison.
func (s *Service) authorizeManage(ctx context.Context, transferID string, token string) (models.Transfer, error) {
	if strings.TrimSpace(token) == "" {
		return models.Transfer{}, &HTTPError{Status: 401, Code: "missing_manage_token", Message: "manage token is required"}
	}

	transfer, err := s.repo.GetTransfer(ctx, transferID)
	if errors.Is(err, repo.ErrNotFound) {
		return models.Transfer{}, &HTTPError{Status: 404, Code: "not_found", Message: "transfer not found"}
	}
	if err != nil {
		return models.Transfer{}, err
	}

	givenHash := hashToken(token)
	if subtle.ConstantTimeCompare([]byte(givenHash), []byte(transfer.ManageTokenHash)) != 1 {
		return models.Transfer{}, &HTTPError{Status: 403, Code: "invalid_manage_token", Message: "manage token is invalid"}
	}

	return transfer, nil
}

// enforceRateLimit translates limiter decisions into API errors.
func (s *Service) enforceRateLimit(ctx context.Context, key string, limit int, window time.Duration) error {
	allowed, err := s.limiter.Allow(ctx, key, limit, window)
	if err != nil {
		return fmt.Errorf("rate limit check: %w", err)
	}
	if !allowed {
		return &HTTPError{Status: 429, Code: "rate_limited", Message: "too many requests"}
	}

	return nil
}

// hashToken stores manage tokens as SHA-256 digests instead of plaintext.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// randomToken generates URL-safe opaque identifiers for transfers and manage tokens.
func randomToken(size int) (string, error) {
	buffer := make([]byte, size)
	if _, err := readRandom(buffer); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buffer), nil
}

// publicStatus collapses internal states into the limited public status model.
func publicStatus(transfer models.Transfer) models.TransferStatus {
	if transfer.DeletedAt != nil || transfer.Status == models.TransferStatusDeleted {
		return models.TransferStatusDeleted
	}
	if isExpired(transfer) {
		return models.TransferStatusExpired
	}
	if transfer.Status != models.TransferStatusReady || transfer.ManifestObjectKey == "" || transfer.WrappedRootKey == "" {
		return models.TransferStatusIncomplete
	}

	return models.TransferStatusReady
}

func isExpired(transfer models.Transfer) bool {
	return transfer.ExpiresAt.Before(time.Now().UTC())
}

func requestedCreateExpiry(request CreateTransferRequest, fallback time.Duration) (time.Duration, error) {
	if request.ExpiresInSeconds > 0 {
		return validateExpiryDuration(time.Duration(request.ExpiresInSeconds) * time.Second)
	}
	if request.ExpiresInDays > 0 {
		return validateExpiryDuration(time.Duration(request.ExpiresInDays) * 24 * time.Hour)
	}

	return validateExpiryDuration(fallback)
}

func requestedUpdateExpiry(request UpdateTransferRequest) (time.Duration, bool, error) {
	if request.ExpiresInSeconds != nil {
		duration, err := validateExpiryDuration(time.Duration(*request.ExpiresInSeconds) * time.Second)
		return duration, true, err
	}
	if request.ExpiresInDays != nil {
		duration, err := validateExpiryDuration(time.Duration(*request.ExpiresInDays) * 24 * time.Hour)
		return duration, true, err
	}

	return 0, false, nil
}

func validateExpiryDuration(duration time.Duration) (time.Duration, error) {
	if !config.IsAllowedExpiry(duration) {
		return 0, &HTTPError{Status: 400, Code: "invalid_expiry", Message: "expiry must match a supported option"}
	}

	return duration, nil
}

// manifestObjectKey is the canonical object path for an encrypted manifest.
func manifestObjectKey(transferID string) string {
	return fmt.Sprintf("transfers/%s/manifest.bin", transferID)
}

// chunkObjectKey is the canonical object path for one encrypted chunk.
func chunkObjectKey(transferID string, fileID string, chunkIndex int) string {
	return fmt.Sprintf("transfers/%s/files/%s/chunks/%08d.bin", transferID, fileID, chunkIndex)
}

// transferPrefix returns the storage prefix containing every object for a transfer.
func transferPrefix(transferID string) string {
	return fmt.Sprintf("transfers/%s/", transferID)
}
