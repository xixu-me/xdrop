import { describe, expect, it } from 'vitest'

import { fromBase64, fromBase64Url, toBase64, toBase64Url } from './base64'

describe('base64 helpers', () => {
  it('round-trips url-safe base64', () => {
    const input = new Uint8Array([1, 2, 3, 250, 251, 252])

    const encoded = toBase64Url(input)

    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(input))
  })

  it('round-trips standard base64', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111])

    expect(Array.from(fromBase64(toBase64(input)))).toEqual(Array.from(input))
  })
})
