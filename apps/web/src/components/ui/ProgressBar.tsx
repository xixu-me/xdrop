type Props = {
  value: number
  label?: string
}

/** ProgressBar clamps percentage input and renders the app's progress treatment. */
export function ProgressBar({ value, label }: Props) {
  return (
    <div className="progress">
      {label ? <div className="progress__label">{label}</div> : null}
      <div className="progress__track">
        <div
          className="progress__fill"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  )
}
