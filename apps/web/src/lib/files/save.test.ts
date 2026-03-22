import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveBlob } from './save'

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the browser download manager instead of a file picker', () => {
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://example.com/download')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')
    const clickSpy = vi.fn()
    const anchor = document.createElement('a')
    anchor.click = clickSpy
    const originalCreateElement = document.createElement.bind(document)

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName.toLowerCase() === 'a') {
        return anchor
      }

      return originalCreateElement(tagName)
    })

    const blob = new Blob(['hello'], { type: 'text/plain' })
    saveBlob(blob, 'hello.txt')

    expect(createObjectURLSpy).toHaveBeenCalledWith(blob)
    expect(anchor.download).toBe('hello.txt')
    expect(anchor.href).toBe('blob:https://example.com/download')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy).toHaveBeenCalledOnce()

    const revokeCallback = setTimeoutSpy.mock.calls[0]?.[0]
    expect(revokeCallback).toBeTypeOf('function')
    ;(revokeCallback as () => void)()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:https://example.com/download')

    createElementSpy.mockRestore()
  })
})
