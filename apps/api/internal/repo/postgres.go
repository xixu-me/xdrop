package repo

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xdrop/monorepo/internal/models"
)

// ErrNotFound reports that a requested transfer does not exist.
var ErrNotFound = errors.New("not found")

type postgresRow interface {
	Scan(dest ...any) error
}

type postgresRows interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

type postgresTx interface {
	Commit(ctx context.Context) error
	Exec(ctx context.Context, sql string, args ...any) error
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
	Rollback(ctx context.Context) error
}

type postgresDB interface {
	Begin(ctx context.Context) (postgresTx, error)
	Exec(ctx context.Context, sql string, args ...any) error
	Query(ctx context.Context, sql string, args ...any) (postgresRows, error)
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
}

type pgxPoolAdapter interface {
	Begin(ctx context.Context) (pgxTxAdapter, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (postgresRows, error)
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
}

type pgxTxAdapter interface {
	Commit(ctx context.Context) error
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) postgresRow
	Rollback(ctx context.Context) error
}

type pgxPoolDB struct {
	pool pgxPoolAdapter
}

type livePGXPool struct {
	pool *pgxpool.Pool
}

func (p livePGXPool) Begin(ctx context.Context) (pgxTxAdapter, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}

	return livePGXTx{tx: tx}, nil
}

func (p livePGXPool) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return p.pool.Exec(ctx, sql, args...)
}

func (p livePGXPool) Query(ctx context.Context, sql string, args ...any) (postgresRows, error) {
	return p.pool.Query(ctx, sql, args...)
}

func (p livePGXPool) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return p.pool.QueryRow(ctx, sql, args...)
}

type livePGXTx struct {
	tx pgx.Tx
}

func (t livePGXTx) Commit(ctx context.Context) error {
	return t.tx.Commit(ctx)
}

func (t livePGXTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.tx.Exec(ctx, sql, args...)
}

func (t livePGXTx) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t livePGXTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}

func (d pgxPoolDB) Begin(ctx context.Context) (postgresTx, error) {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}

	return pgxTx{tx: tx}, nil
}

func (d pgxPoolDB) Exec(ctx context.Context, sql string, args ...any) error {
	_, err := d.pool.Exec(ctx, sql, args...)
	return err
}

func (d pgxPoolDB) Query(ctx context.Context, sql string, args ...any) (postgresRows, error) {
	return d.pool.Query(ctx, sql, args...)
}

func (d pgxPoolDB) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return d.pool.QueryRow(ctx, sql, args...)
}

type pgxTx struct {
	tx pgxTxAdapter
}

func (t pgxTx) Commit(ctx context.Context) error {
	return t.tx.Commit(ctx)
}

func (t pgxTx) Exec(ctx context.Context, sql string, args ...any) error {
	_, err := t.tx.Exec(ctx, sql, args...)
	return err
}

func (t pgxTx) QueryRow(ctx context.Context, sql string, args ...any) postgresRow {
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t pgxTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}

// PostgresRepository stores transfers, files, and chunks in PostgreSQL.
type PostgresRepository struct {
	db postgresDB
}

// NewPostgresRepository wraps a pgx pool with the repository implementation.
func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: pgxPoolDB{pool: livePGXPool{pool: db}}}
}

// CreateTransfer inserts a new transfer in draft state.
func (r *PostgresRepository) CreateTransfer(ctx context.Context, transfer models.Transfer) error {
	err := r.db.Exec(ctx, `
		INSERT INTO transfers (
			id, status, expires_at, manage_token_hash, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $5)
	`, transfer.ID, transfer.Status, transfer.ExpiresAt, transfer.ManageTokenHash, transfer.CreatedAt)
	if err != nil {
		return fmt.Errorf("insert transfer: %w", err)
	}

	return nil
}

// GetTransfer loads the persisted transfer record for the given identifier.
func (r *PostgresRepository) GetTransfer(ctx context.Context, transferID string) (models.Transfer, error) {
	var transfer models.Transfer

	err := r.db.QueryRow(ctx, `
		SELECT
			id, status, wrapped_root_key, manifest_object_key, manifest_ciphertext_size,
			total_files, total_ciphertext_bytes, expires_at, created_at, updated_at,
			finalized_at, manage_token_hash, deleted_at, purged_at
		FROM transfers
		WHERE id = $1
	`, transferID).Scan(
		&transfer.ID,
		&transfer.Status,
		&transfer.WrappedRootKey,
		&transfer.ManifestObjectKey,
		&transfer.ManifestCiphertextSize,
		&transfer.TotalFiles,
		&transfer.TotalCiphertextBytes,
		&transfer.ExpiresAt,
		&transfer.CreatedAt,
		&transfer.UpdatedAt,
		&transfer.FinalizedAt,
		&transfer.ManageTokenHash,
		&transfer.DeletedAt,
		&transfer.PurgedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Transfer{}, ErrNotFound
	}
	if err != nil {
		return models.Transfer{}, fmt.Errorf("select transfer: %w", err)
	}

	return transfer, nil
}

// RegisterFiles upserts file metadata and marks the transfer as uploading.
func (r *PostgresRepository) RegisterFiles(ctx context.Context, transferID string, files []models.TransferFile) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin register files: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, file := range files {
		err = tx.Exec(ctx, `
			INSERT INTO transfer_files (
				transfer_id, opaque_file_id, total_chunks, ciphertext_bytes, plaintext_bytes, chunk_size, upload_status, created_at, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
			ON CONFLICT (transfer_id, opaque_file_id) DO UPDATE
			SET total_chunks = EXCLUDED.total_chunks,
				ciphertext_bytes = EXCLUDED.ciphertext_bytes,
				plaintext_bytes = EXCLUDED.plaintext_bytes,
				chunk_size = EXCLUDED.chunk_size,
				updated_at = now()
		`, transferID, file.OpaqueFileID, file.TotalChunks, file.CiphertextBytes, file.PlaintextBytes, file.ChunkSize, "pending")
		if err != nil {
			return fmt.Errorf("insert file %s: %w", file.OpaqueFileID, err)
		}
	}

	err = tx.Exec(ctx, `UPDATE transfers SET status = $2, updated_at = now() WHERE id = $1`, transferID, models.TransferStatusUploading)
	if err != nil {
		return fmt.Errorf("set uploading status: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit register files: %w", err)
	}

	return nil
}

// ListFiles returns every file registered for a transfer in stable order.
func (r *PostgresRepository) ListFiles(ctx context.Context, transferID string) ([]models.TransferFile, error) {
	rows, err := r.db.Query(ctx, `
		SELECT transfer_id, opaque_file_id, total_chunks, ciphertext_bytes, plaintext_bytes, chunk_size, upload_status, created_at, updated_at
		FROM transfer_files
		WHERE transfer_id = $1
		ORDER BY opaque_file_id
	`, transferID)
	if err != nil {
		return nil, fmt.Errorf("query files: %w", err)
	}
	defer rows.Close()

	files := []models.TransferFile{}
	for rows.Next() {
		var file models.TransferFile
		if err := rows.Scan(
			&file.TransferID,
			&file.OpaqueFileID,
			&file.TotalChunks,
			&file.CiphertextBytes,
			&file.PlaintextBytes,
			&file.ChunkSize,
			&file.UploadStatus,
			&file.CreatedAt,
			&file.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan file: %w", err)
		}
		files = append(files, file)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate files: %w", err)
	}

	return files, nil
}

// CompleteChunks records uploaded chunks and advances per-file upload status.
func (r *PostgresRepository) CompleteChunks(ctx context.Context, transferID string, chunks []models.TransferChunk) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin complete chunks: %w", err)
	}
	defer tx.Rollback(ctx)

	filesTouched := []string{}
	for _, chunk := range chunks {
		err = tx.Exec(ctx, `
			INSERT INTO transfer_chunks (
				transfer_id, opaque_file_id, chunk_index, object_key, ciphertext_size, checksum_sha256, uploaded_at
			) VALUES ($1, $2, $3, $4, $5, $6, now())
			ON CONFLICT (transfer_id, opaque_file_id, chunk_index) DO UPDATE
			SET object_key = EXCLUDED.object_key,
				ciphertext_size = EXCLUDED.ciphertext_size,
				checksum_sha256 = EXCLUDED.checksum_sha256,
				uploaded_at = now()
		`, transferID, chunk.OpaqueFileID, chunk.ChunkIndex, chunk.ObjectKey, chunk.CiphertextSize, chunk.ChecksumSHA256)
		if err != nil {
			return fmt.Errorf("upsert chunk %s/%d: %w", chunk.OpaqueFileID, chunk.ChunkIndex, err)
		}

		if !slices.Contains(filesTouched, chunk.OpaqueFileID) {
			filesTouched = append(filesTouched, chunk.OpaqueFileID)
		}
	}

	for _, fileID := range filesTouched {
		var totalChunks int
		if err = tx.QueryRow(ctx, `SELECT total_chunks FROM transfer_files WHERE transfer_id = $1 AND opaque_file_id = $2`, transferID, fileID).Scan(&totalChunks); err != nil {
			return fmt.Errorf("select file chunk count %s: %w", fileID, err)
		}

		var uploadedCount int
		if err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM transfer_chunks WHERE transfer_id = $1 AND opaque_file_id = $2`, transferID, fileID).Scan(&uploadedCount); err != nil {
			return fmt.Errorf("count uploaded chunks %s: %w", fileID, err)
		}

		status := "pending"
		if uploadedCount >= totalChunks {
			status = "complete"
		}

		if err = tx.Exec(ctx, `UPDATE transfer_files SET upload_status = $3, updated_at = now() WHERE transfer_id = $1 AND opaque_file_id = $2`, transferID, fileID, status); err != nil {
			return fmt.Errorf("update file status %s: %w", fileID, err)
		}
	}

	if err = tx.Exec(ctx, `UPDATE transfers SET updated_at = now() WHERE id = $1`, transferID); err != nil {
		return fmt.Errorf("touch transfer: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit complete chunks: %w", err)
	}

	return nil
}

// GetResumeState reconstructs the transfer, its files, and uploaded chunk indexes.
func (r *PostgresRepository) GetResumeState(ctx context.Context, transferID string) (models.TransferResumeState, error) {
	transfer, err := r.GetTransfer(ctx, transferID)
	if err != nil {
		return models.TransferResumeState{}, err
	}

	files, err := r.ListFiles(ctx, transferID)
	if err != nil {
		return models.TransferResumeState{}, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT opaque_file_id, chunk_index
		FROM transfer_chunks
		WHERE transfer_id = $1
		ORDER BY opaque_file_id, chunk_index
	`, transferID)
	if err != nil {
		return models.TransferResumeState{}, fmt.Errorf("query chunks: %w", err)
	}
	defer rows.Close()

	uploaded := map[string][]int{}
	for rows.Next() {
		var fileID string
		var chunkIndex int
		if err := rows.Scan(&fileID, &chunkIndex); err != nil {
			return models.TransferResumeState{}, fmt.Errorf("scan chunk: %w", err)
		}
		uploaded[fileID] = append(uploaded[fileID], chunkIndex)
	}
	if err := rows.Err(); err != nil {
		return models.TransferResumeState{}, fmt.Errorf("iterate chunks: %w", err)
	}

	return models.TransferResumeState{
		Transfer:       transfer,
		Files:          files,
		UploadedChunks: uploaded,
	}, nil
}

// SetManifest stores the manifest object location after the ciphertext upload succeeds.
func (r *PostgresRepository) SetManifest(ctx context.Context, transferID string, objectKey string, ciphertextSize int64) error {
	taggedStatus := models.TransferStatusUploading
	err := r.db.Exec(ctx, `
		UPDATE transfers
		SET manifest_object_key = $2, manifest_ciphertext_size = $3, status = $4, updated_at = now()
		WHERE id = $1
	`, transferID, objectKey, ciphertextSize, taggedStatus)
	if err != nil {
		return fmt.Errorf("set manifest: %w", err)
	}

	return nil
}

// FinalizeTransfer verifies completeness and promotes the transfer to ready state.
func (r *PostgresRepository) FinalizeTransfer(ctx context.Context, transferID string, wrappedRootKey string, totalFiles int, totalCiphertextBytes int64) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin finalize: %w", err)
	}
	defer tx.Rollback(ctx)

	var manifestObjectKey string
	if err = tx.QueryRow(ctx, `SELECT manifest_object_key FROM transfers WHERE id = $1`, transferID).Scan(&manifestObjectKey); err != nil {
		return fmt.Errorf("select manifest object key: %w", err)
	}
	if manifestObjectKey == "" {
		return fmt.Errorf("manifest not registered")
	}

	var incompleteCount int
	if err = tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM transfer_files
		WHERE transfer_id = $1 AND upload_status <> 'complete'
	`, transferID).Scan(&incompleteCount); err != nil {
		return fmt.Errorf("count incomplete files: %w", err)
	}
	if incompleteCount > 0 {
		return fmt.Errorf("upload incomplete")
	}

	finalizedAt := time.Now().UTC()
	err = tx.Exec(ctx, `
		UPDATE transfers
		SET wrapped_root_key = $2,
			total_files = $3,
			total_ciphertext_bytes = $4,
			status = $5,
			finalized_at = $6,
			updated_at = $6
		WHERE id = $1
	`, transferID, wrappedRootKey, totalFiles, totalCiphertextBytes, models.TransferStatusReady, finalizedAt)
	if err != nil {
		return fmt.Errorf("update finalized transfer: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit finalize: %w", err)
	}

	return nil
}

// UpdateTransfer applies supported metadata changes without rewriting immutable fields.
func (r *PostgresRepository) UpdateTransfer(ctx context.Context, transferID string, params models.UpdateTransferParams) error {
	if params.ManifestObjectKey != nil {
		err := r.db.Exec(ctx, `
			UPDATE transfers
			SET manifest_object_key = $2, updated_at = now()
			WHERE id = $1
		`, transferID, *params.ManifestObjectKey)
		if err != nil {
			return fmt.Errorf("update manifest object key: %w", err)
		}
	}

	if params.ExpiresAt != nil {
		err := r.db.Exec(ctx, `UPDATE transfers SET expires_at = $2, updated_at = now() WHERE id = $1`, transferID, *params.ExpiresAt)
		if err != nil {
			return fmt.Errorf("update expires_at: %w", err)
		}
	}

	if params.ManifestCiphertextSize != nil {
		err := r.db.Exec(ctx, `
			UPDATE transfers
			SET manifest_ciphertext_size = $2, updated_at = now()
			WHERE id = $1
		`, transferID, *params.ManifestCiphertextSize)
		if err != nil {
			return fmt.Errorf("update manifest size: %w", err)
		}
	}

	return nil
}

// MarkDeleted tombstones a transfer while retaining enough metadata for cleanup.
func (r *PostgresRepository) MarkDeleted(ctx context.Context, transferID string) error {
	err := r.db.Exec(ctx, `
		UPDATE transfers
		SET status = $2, deleted_at = now(), updated_at = now()
		WHERE id = $1
	`, transferID, models.TransferStatusDeleted)
	if err != nil {
		return fmt.Errorf("mark deleted: %w", err)
	}

	return nil
}

// ListCleanupCandidates returns transfers whose remote objects should be purged.
func (r *PostgresRepository) ListCleanupCandidates(ctx context.Context, limit int) ([]models.Transfer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			id, status, wrapped_root_key, manifest_object_key, manifest_ciphertext_size,
			total_files, total_ciphertext_bytes, expires_at, created_at, updated_at,
			finalized_at, manage_token_hash, deleted_at, purged_at
		FROM transfers
		WHERE purged_at IS NULL
		  AND (
			(status = 'deleted' AND deleted_at IS NOT NULL)
			OR (status IN ('ready', 'uploading', 'draft', 'failed') AND expires_at <= now())
			OR status = 'expired'
		  )
		ORDER BY updated_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("query cleanup candidates: %w", err)
	}
	defer rows.Close()

	transfers := []models.Transfer{}
	for rows.Next() {
		var transfer models.Transfer
		if err := rows.Scan(
			&transfer.ID,
			&transfer.Status,
			&transfer.WrappedRootKey,
			&transfer.ManifestObjectKey,
			&transfer.ManifestCiphertextSize,
			&transfer.TotalFiles,
			&transfer.TotalCiphertextBytes,
			&transfer.ExpiresAt,
			&transfer.CreatedAt,
			&transfer.UpdatedAt,
			&transfer.FinalizedAt,
			&transfer.ManageTokenHash,
			&transfer.DeletedAt,
			&transfer.PurgedAt,
		); err != nil {
			return nil, fmt.Errorf("scan cleanup transfer: %w", err)
		}
		if transfer.Status != models.TransferStatusDeleted && transfer.ExpiresAt.Before(time.Now().UTC()) {
			transfer.Status = models.TransferStatusExpired
		}
		transfers = append(transfers, transfer)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cleanup transfers: %w", err)
	}

	return transfers, nil
}

// MarkPurged records that all remote objects for a transfer have been removed.
func (r *PostgresRepository) MarkPurged(ctx context.Context, transferID string) error {
	err := r.db.Exec(ctx, `
		UPDATE transfers
		SET status = $2, purged_at = now(), updated_at = now()
		WHERE id = $1
	`, transferID, models.TransferStatusExpired)
	if err != nil {
		return fmt.Errorf("mark purged: %w", err)
	}

	return nil
}
