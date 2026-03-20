/** formatBytes renders byte counts in the human-friendly binary units used across the UI. */
export function formatBytes(value: number) {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`
  }
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MiB`
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KiB`
  }
  return `${value} B`
}
