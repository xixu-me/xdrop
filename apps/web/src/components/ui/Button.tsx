import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'

type Props = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: 'primary' | 'ghost' | 'danger'
  }
>

/** Button wraps the shared visual treatment for actions across the app. */
export function Button({ children, className = '', tone = 'primary', ...props }: Props) {
  return (
    <button
      className={`button button--${tone} ${className}`.trim()}
      type={props.type ?? 'button'}
      {...props}
    >
      {children}
    </button>
  )
}
