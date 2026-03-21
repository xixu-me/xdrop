/**
 * Browser-local date and time formatting shared across sender and receiver surfaces.
 */

const DEFAULT_DATE_TIME_OPTIONS = {
  dateStyle: 'medium',
  timeStyle: 'short',
} as const satisfies Intl.DateTimeFormatOptions

/** formatLocalDateTime renders an ISO timestamp with the user's locale preferences. */
export function formatLocalDateTime(
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return new Intl.DateTimeFormat(getPreferredLocales(), {
    ...DEFAULT_DATE_TIME_OPTIONS,
    ...options,
  }).format(date)
}

function getPreferredLocales() {
  if (typeof navigator === 'undefined') {
    return undefined
  }

  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages
  }

  return navigator.language ? [navigator.language] : undefined
}
