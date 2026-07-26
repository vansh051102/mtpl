import { cn } from '@/lib/utils'

interface TrendArrowProps {
  deltaPct: number
}

/** Small CSS-triangle trend arrow + percent. No chart library. */
export function TrendArrow({ deltaPct }: TrendArrowProps) {
  if (deltaPct === 0) return <span className="text-xs text-muted-foreground">flat</span>
  const up = deltaPct > 0
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', up ? 'text-apple-green' : 'text-apple-red')}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {Math.abs(deltaPct)}%
    </span>
  )
}
