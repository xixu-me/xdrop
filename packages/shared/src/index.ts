/**
 * Shared protocol versions, public limits, and UI options consumed by both apps.
 */

/** Envelope versions let clients reject incompatible manifest or key formats. */
export const MANIFEST_VERSION = 1
export const WRAP_VERSION = 1
/** Upload defaults and hard limits enforced across the product. */
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024
export const MAX_UPLOAD_CONCURRENCY = 6
export const DEFAULT_EXPIRY_SECONDS = 60 * 60
/** EXPIRY_OPTIONS is the canonical list of user-selectable retention windows. */
export const EXPIRY_OPTIONS = [
  { value: 5 * 60, label: '5 minutes' },
  { value: 10 * 60, label: '10 minutes' },
  { value: 30 * 60, label: '30 minutes' },
  { value: 60 * 60, label: '1 hour' },
  { value: 3 * 60 * 60, label: '3 hours' },
  { value: 6 * 60 * 60, label: '6 hours' },
  { value: 12 * 60 * 60, label: '12 hours' },
  { value: 24 * 60 * 60, label: '1 day' },
  { value: 3 * 24 * 60 * 60, label: '3 days' },
  { value: 7 * 24 * 60 * 60, label: '1 week' },
] as const
export const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60
export const MAX_FILE_COUNT = 100
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024
export const SOURCE_BLOB_PERSIST_LIMIT = 256 * 1024 * 1024

/** ExpiryOption is the union of supported expiry values expressed in seconds. */
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]['value']

/** getExpiryOptionLabel resolves a supported expiry value to the label shown in the UI. */
export function getExpiryOptionLabel(value: ExpiryOption) {
  return EXPIRY_OPTIONS.find((option) => option.value === value)?.label ?? `${value} seconds`
}
