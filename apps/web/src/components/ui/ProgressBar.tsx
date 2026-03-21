type Props = {
  value: number
  label?: string
}

/** ProgressBar clamps percentage input and renders the app's progress treatment. */
export function ProgressBar({ value, label }: Props) {
  const clampedValue = Math.max(0, Math.min(100, value))

  return (
    <div className="progress">
      {label ? <div className="progress__label">{label}</div> : null}
      <div
        aria-label={label ?? 'Progress'}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={clampedValue}
        aria-valuetext={label}
        className="progress__track"
        role="progressbar"
      >
        <div className="progress__fill" style={{ width: `${clampedValue}%` }} />
      </div>
    </div>
  )
}
