import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface MetricStripItem {
  label: string
  value: string
  href: string
  helper?: string
}

export function SingleMetricStrip({ items }: { items: MetricStripItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={cn(
            'rounded-3xl border border-border bg-card px-5 py-4 shadow-apple-card transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-apple-float'
          )}
        >
          <p className="text-sm text-muted-foreground">{item.label}</p>
          <p className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">{item.value}</p>
          {item.helper && <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>}
        </Link>
      ))}
    </div>
  )
}
