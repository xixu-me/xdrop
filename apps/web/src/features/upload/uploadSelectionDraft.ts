/**
 * Persistence helpers for the upload composer draft stored locally in the browser.
 */

import { DEFAULT_EXPIRY_SECONDS, SOURCE_BLOB_PERSIST_LIMIT, type ExpiryOption } from '@xdrop/shared'

import {
  createIndexedDbSourceRecord,
  loadPersistedSourceFile,
  persistSourceToOpfs,
  supportsOpfsSourcePersistence,
} from '@/lib/files/persistentSources'
import {
  deleteSourcesByKeys,
  deleteSourcesForTransfer,
  getSourcesForTransfer,
  putSources,
  type PersistedSourceRecord,
} from '@/lib/indexeddb/db'
import type { SelectedSource } from './TransferContext'

const UPLOAD_SELECTION_DRAFT_ID = '__upload-selection__'
const UPLOAD_SELECTION_SETTINGS_KEY = 'xdrop:upload-selection:draft'

/** UploadSelectionDraftSource adds the persisted draft key to a staged source file. */
export type UploadSelectionDraftSource = SelectedSource & {
  draftKey?: string
}

/** UploadSelectionDraftSettings captures the non-file choices in the upload composer that are
 * safe to persist in localStorage.
 */
export type UploadSelectionDraftSettings = {
  displayName: string
  expiresInSeconds: ExpiryOption
  stripMetadata: boolean
}

type LoadedUploadSelectionDraft = {
  sources: UploadSelectionDraftSource[]
  settings: UploadSelectionDraftSettings
}

/** loadUploadSelectionDraft restores staged files and UI settings after a refresh. */
export async function loadUploadSelectionDraft(): Promise<LoadedUploadSelectionDraft> {
  const records = await getSourcesForTransfer(UPLOAD_SELECTION_DRAFT_ID)
  const loadedSources = await Promise.all(
    records.map(async (record) => {
      const file = await loadPersistedSourceFile(record)
      if (!file) {
        return null
      }

      return {
        draftKey: record.key,
        file,
        relativePath: record.relativePath,
      } satisfies UploadSelectionDraftSource
    }),
  )
  const restoredSources = loadedSources.filter(
    (source): source is NonNullable<(typeof loadedSources)[number]> => source !== null,
  )

  const missingKeys = records
    .filter((record) => !restoredSources.some((source) => source.draftKey === record.key))
    .map((record) => record.key)

  if (missingKeys.length > 0) {
    await deleteSourcesByKeys(missingKeys)
  }

  return {
    sources: restoredSources,
    settings: loadUploadSelectionDraftSettings(),
  }
}

/** persistUploadSelectionDraftSources keeps the staged file selection resilient across reloads. */
export async function persistUploadSelectionDraftSources(
  sources: UploadSelectionDraftSource[],
): Promise<UploadSelectionDraftSource[]> {
  const currentRecords = await getSourcesForTransfer(UPLOAD_SELECTION_DRAFT_ID)
  const currentRecordKeys = new Set(currentRecords.map((record) => record.key))
  const desiredKeys = new Set<string>()
  const nextSources: UploadSelectionDraftSource[] = []
  const newRecords: PersistedSourceRecord[] = []
  const useOpfs = supportsOpfsSourcePersistence()
  let indexedDbBytes = currentRecords
    .filter(
      (record) =>
        record.storage === 'indexeddb' && sources.some((source) => source.draftKey === record.key),
    )
    .reduce((sum, record) => sum + record.size, 0)

  for (const source of sources) {
    if (source.draftKey && currentRecordKeys.has(source.draftKey)) {
      desiredKeys.add(source.draftKey)
      nextSources.push(source)
      continue
    }

    const persistedSource = await persistDraftSource(source, useOpfs, indexedDbBytes)
    if (persistedSource.storage === 'indexeddb') {
      indexedDbBytes += persistedSource.size
    }
    newRecords.push(persistedSource)
    desiredKeys.add(persistedSource.key)
    nextSources.push({
      ...source,
      draftKey: persistedSource.key,
    })
  }

  if (newRecords.length > 0) {
    await putSources(newRecords)
  }

  const staleKeys = currentRecords
    .filter((record) => !desiredKeys.has(record.key))
    .map((record) => record.key)

  if (staleKeys.length > 0) {
    await deleteSourcesByKeys(staleKeys)
  }

  return nextSources
}

/** saveUploadSelectionDraftSettings stores the non-file draft settings in localStorage. */
export function saveUploadSelectionDraftSettings(settings: UploadSelectionDraftSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(UPLOAD_SELECTION_SETTINGS_KEY, JSON.stringify(settings))
}

/** clearUploadSelectionDraft removes both staged files and saved composer settings. */
export async function clearUploadSelectionDraft() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(UPLOAD_SELECTION_SETTINGS_KEY)
  }
  await deleteSourcesForTransfer(UPLOAD_SELECTION_DRAFT_ID)
}

function loadUploadSelectionDraftSettings(): UploadSelectionDraftSettings {
  if (typeof window === 'undefined') {
    return defaultDraftSettings()
  }

  const raw = window.localStorage.getItem(UPLOAD_SELECTION_SETTINGS_KEY)
  if (!raw) {
    return defaultDraftSettings()
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UploadSelectionDraftSettings>
    return {
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      expiresInSeconds:
        typeof parsed.expiresInSeconds === 'number'
          ? (parsed.expiresInSeconds as ExpiryOption)
          : DEFAULT_EXPIRY_SECONDS,
      stripMetadata: typeof parsed.stripMetadata === 'boolean' ? parsed.stripMetadata : true,
    }
  } catch {
    return defaultDraftSettings()
  }
}

/** persistDraftSource stores a staged file in OPFS when possible and IndexedDB as fallback. */
async function persistDraftSource(
  source: SelectedSource,
  useOpfs: boolean,
  indexedDbBytes: number,
) {
  const fileId = createDraftFileId()

  let persistedSource: PersistedSourceRecord | null = null
  if (useOpfs) {
    persistedSource = await persistSourceToOpfs({
      transferId: UPLOAD_SELECTION_DRAFT_ID,
      fileId,
      relativePath: source.relativePath,
      file: source.file,
    })
  }

  if (!persistedSource && indexedDbBytes + source.file.size <= SOURCE_BLOB_PERSIST_LIMIT) {
    persistedSource = createIndexedDbSourceRecord({
      transferId: UPLOAD_SELECTION_DRAFT_ID,
      fileId,
      relativePath: source.relativePath,
      file: source.file,
    })
  }

  if (!persistedSource) {
    throw new Error(
      useOpfs
        ? "This browser couldn't reserve enough local storage to keep this selection after refresh."
        : 'To keep this selection after refresh, use a browser with OPFS support or choose smaller files.',
    )
  }

  return persistedSource
}

function createDraftFileId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function defaultDraftSettings(): UploadSelectionDraftSettings {
  return {
    displayName: '',
    expiresInSeconds: DEFAULT_EXPIRY_SECONDS,
    stripMetadata: true,
  }
}
