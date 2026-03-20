import { describe, expect, it } from 'vitest'

import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('formats byte-sized values', () => {
    expect(formatBytes(999)).toBe('999 B')
  })

  it('formats kibibytes, mebibytes, and gibibytes', () => {
    expect(formatBytes(2_048)).toBe('2 KiB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MiB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GiB')
  })
})
