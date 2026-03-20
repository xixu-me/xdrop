CREATE TABLE IF NOT EXISTS transfers (
    id text PRIMARY KEY,
    status text NOT NULL,
    wrapped_root_key text NOT NULL DEFAULT '',
    manifest_object_key text NOT NULL DEFAULT '',
    manifest_ciphertext_size bigint NOT NULL DEFAULT 0,
    total_files integer NOT NULL DEFAULT 0,
    total_ciphertext_bytes bigint NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finalized_at timestamptz,
    manage_token_hash text NOT NULL,
    deleted_at timestamptz,
    purged_at timestamptz
);

CREATE TABLE IF NOT EXISTS transfer_files (
    id bigserial PRIMARY KEY,
    transfer_id text NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    opaque_file_id text NOT NULL,
    total_chunks integer NOT NULL,
    ciphertext_bytes bigint NOT NULL,
    plaintext_bytes bigint,
    chunk_size bigint NOT NULL,
    upload_status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transfer_id, opaque_file_id)
);

CREATE TABLE IF NOT EXISTS transfer_chunks (
    id bigserial PRIMARY KEY,
    transfer_id text NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
    opaque_file_id text NOT NULL,
    chunk_index integer NOT NULL,
    object_key text NOT NULL,
    ciphertext_size bigint NOT NULL,
    checksum_sha256 text NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (transfer_id, opaque_file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_transfers_status_expires ON transfers(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_transfer_files_transfer_id ON transfer_files(transfer_id);
CREATE INDEX IF NOT EXISTS idx_transfer_chunks_transfer_file ON transfer_chunks(transfer_id, opaque_file_id);
