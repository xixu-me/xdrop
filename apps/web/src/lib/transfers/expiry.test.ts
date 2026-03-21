import { describe, expect, it } from 'vitest'

import type { LocalTransferRecord } from '@/lib/indexeddb/db'

import { isExpiredTransfer } from './expiry'

function createTransfer(
  expiresAt: string,
  overrides: Partial<LocalTransferRecord> = {},
): LocalTransferRecord {
  return {
    clearLocalSecretsOnReady: false,
    createdAt: '2026-03-20T08:00:00.000Z',
    displayName: 'Transfer',
    expiresAt,
    files: [],
    id: 'transfer-1',
    linkKeyBase64Url: 'AQID',
    localManagementCleared: false,
    manageToken: 'manage-token',
    metadataStrippingEnabled: false,
    rootKeyBase64Url: 'AQID',
    shareUrl: 'https://example.com/t/transfer-1',
    sourcePersisted: false,
    status: 'ready',
    totalBytes: 1024,
    totalFiles: 1,
    uploadedBytes: 1024,
    ...overrides,
  }
}

describe('isExpiredTransfer', () => {
  it('returns true when the transfer expiry has passed', () => {
    expect(
      isExpiredTransfer(
        createTransfer('2026-03-19T10:00:00.000Z'),
        Date.parse('2026-03-20T10:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('returns false for deleted transfers and invalid timestamps', () => {
    expect(
      isExpiredTransfer(
        createTransfer('2026-03-19T10:00:00.000Z', { status: 'deleted' }),
        Date.parse('2026-03-20T10:00:00.000Z'),
      ),
    ).toBe(false)

    expect(
      isExpiredTransfer(createTransfer('not-a-date'), Date.parse('2026-03-20T10:00:00.000Z')),
    ).toBe(false)
  })
})
