import type { PropsWithChildren } from 'react'

import { Card } from './Card'

type Props = PropsWithChildren<{
  body: string
  className?: string
  eyebrow?: string
  title: string
}>

/** PageStateCard renders loading, empty, and error states with the shared hero layout. */
export function PageStateCard({
  body,
  children,
  className = '',
  eyebrow = 'Status',
  title,
}: Props) {
  return (
    <Card className={`hero-card page-hero-card page-state-card ${className}`.trim()}>
      <div className="page-hero-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="muted page-intro">{body}</p>
      </div>
      {children}
    </Card>
  )
}
