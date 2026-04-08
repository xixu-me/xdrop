import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatLocalDateTime } from './formatDateTime'

const originalNavigator = globalThis.navigator

describe('formatLocalDateTime', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    })
    vi.restoreAllMocks()
  })

  it('returns an empty string for invalid date values', () => {
    expect(formatLocalDateTime('not-a-date')).toBe('')
  })

  it('prefers navigator.language when navigator.languages is empty', () => {
    let observedLocales: Intl.LocalesArgument | undefined
    let observedOptions: Intl.DateTimeFormatOptions | undefined
    const DateTimeFormatMock = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        observedLocales = locales
        observedOptions = options
        return {
          format: () => 'formatted',
        } as Intl.DateTimeFormat
      })

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        language: 'fr-FR',
        languages: [],
      },
    })

    expect(formatLocalDateTime('2026-03-20T10:00:00.000Z')).toBe('formatted')
    expect(DateTimeFormatMock).toHaveBeenCalledTimes(1)
    expect(observedLocales).toEqual(['fr-FR'])
    expect(observedOptions).toMatchObject({
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  })

  it('falls back to an undefined locale list when navigator is unavailable', () => {
    let observedLocales: Intl.LocalesArgument | undefined
    let observedOptions: Intl.DateTimeFormatOptions | undefined
    const DateTimeFormatMock = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        observedLocales = locales
        observedOptions = options
        return {
          format: () => 'formatted',
        } as Intl.DateTimeFormat
      })

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: undefined,
    })

    expect(formatLocalDateTime('2026-03-20T10:00:00.000Z')).toBe('formatted')
    expect(DateTimeFormatMock).toHaveBeenCalledTimes(1)
    expect(observedLocales).toBeUndefined()
    expect(observedOptions).toMatchObject({
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  })
})
