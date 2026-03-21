import type { PropsWithChildren } from 'react'

type Props = PropsWithChildren<{
  className?: string
}>

/** Card is the base surface component used for all major panels. */
export function Card({ children, className = '' }: Props) {
  return <section className={`card ${className}`.trim()}>{children}</section>
}
