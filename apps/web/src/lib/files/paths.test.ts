import { describe, expect, it } from 'vitest'

import { safeDownloadName, sanitizePath } from './paths'

describe('paths', () => {
  it('sanitizes reserved characters, control bytes, and traversal segments', () => {
    expect(sanitizePath('../folder\\bad:name?.txt')).toBe('folder/bad_name_.txt')
    expect(sanitizePath(`safe/${String.fromCharCode(1)}name.txt`)).toBe('safe/_name.txt')
  })

  it('falls back to a generic filename when nothing remains after sanitizing', () => {
    expect(safeDownloadName('../')).toBe('download.bin')
  })
})
