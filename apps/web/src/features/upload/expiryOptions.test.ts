import {
  DEFAULT_EXPIRY_SECONDS,
  EXPIRY_OPTIONS,
  MAX_EXPIRY_SECONDS,
  getExpiryOptionLabel,
} from '@xdrop/shared'
import { describe, expect, it } from 'vitest'

describe('expiry options', () => {
  it('matches the current PrivateBin presets and default selection', () => {
    expect(EXPIRY_OPTIONS.map((option) => option.label)).toEqual([
      '5 minutes',
      '10 minutes',
      '30 minutes',
      '1 hour',
      '3 hours',
      '6 hours',
      '12 hours',
      '1 day',
      '3 days',
      '1 week',
    ])
    expect(DEFAULT_EXPIRY_SECONDS).toBe(60 * 60)
    expect(MAX_EXPIRY_SECONDS).toBe(7 * 24 * 60 * 60)
  })

  it('returns a readable label for supported expiry values', () => {
    expect(getExpiryOptionLabel(5 * 60)).toBe('5 minutes')
    expect(getExpiryOptionLabel(7 * 24 * 60 * 60)).toBe('1 week')
  })
})
