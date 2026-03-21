package models

import "time"

// TransferStatus describes the lifecycle stage of a transfer in persistent storage.
type TransferStatus string

const (
	// Draft transfers exist but do not have any registered files yet.
	TransferStatusDraft TransferStatus = "draft"
	// Uploading transfers have registered files and may still be receiving chunks.
	TransferStatusUploading TransferStatus = "uploading"
	// Ready transfers have a manifest, wrapped root key, and all chunks uploaded.
	TransferStatusReady TransferStatus = "ready"
	// Incomplete transfers are visible to the public API but not yet downloadable.
	TransferStatusIncomplete TransferStatus = "incomplete"
	// Expired transfers have passed their retention window and await cleanup.
	TransferStatusExpired TransferStatus = "expired"
	// Deleted transfers were explicitly removed by their creator.
	TransferStatusDeleted TransferStatus = "deleted"
	// Failed transfers represent interrupted local state that never became ready.
	TransferStatusFailed TransferStatus = "failed"
)

// Transfer stores transfer-level metadata and lifecycle state.
type Transfer struct {
	ID                     string
	Status                 TransferStatus
	WrappedRootKey         string
	ManifestObjectKey      string
	ManifestCiphertextSize int64
	TotalFiles             int
	TotalCiphertextBytes   int64
	ExpiresAt              time.Time
	CreatedAt              time.Time
	UpdatedAt              time.Time
	FinalizedAt            *time.Time
	ManageTokenHash        string
	DeletedAt              *time.Time
	PurgedAt               *time.Time
}

// TransferFile stores file-level metadata for a transfer.
type TransferFile struct {
	TransferID      string
	OpaqueFileID    string
	TotalChunks     int
	CiphertextBytes int64
	PlaintextBytes  *int64
	ChunkSize       int64
	UploadStatus    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// TransferChunk tracks each uploaded ciphertext chunk.
type TransferChunk struct {
	TransferID     string
	OpaqueFileID   string
	ChunkIndex     int
	ObjectKey      string
	CiphertextSize int64
	ChecksumSHA256 string
	UploadedAt     time.Time
}

// TransferResumeState combines a transfer with file metadata and completed chunk indexes.
type TransferResumeState struct {
	Transfer       Transfer
	Files          []TransferFile
	UploadedChunks map[string][]int
}

// UpdateTransferParams describes the mutable fields the service can update after creation.
type UpdateTransferParams struct {
	ManifestObjectKey      *string
	ExpiresAt              *time.Time
	EncryptedManifest      []byte
	ManifestCiphertextSize *int64
}
