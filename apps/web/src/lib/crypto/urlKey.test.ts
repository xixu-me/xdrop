import { describe, expect, it } from 'vitest'

import { fromBase64Url } from './base64'
import { parseLinkKey, serializeLinkKey } from './urlKey'

describe('url fragment link key', () => {
  it('serializes and parses a fragment key', () => {
    const raw = fromBase64Url('AQIDBAUGBwgJCgsMDQ4PEA')
    const fragment = `#k=${serializeLinkKey(raw)}`

    expect(Array.from(parseLinkKey(fragment) ?? new Uint8Array())).toEqual(Array.from(raw))
  })

  it('returns null for a missing fragment', () => {
    expect(parseLinkKey(undefined)).toBeNull()
    expect(parseLinkKey('#missing=value')).toBeNull()
  })

  it('returns null for malformed keys', () => {
    expect(parseLinkKey('#k=%%%')).toBeNull()
  })
})
