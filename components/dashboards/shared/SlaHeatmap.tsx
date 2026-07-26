import { cn } from '@/lib/utils'

export interface SlaHeatmapRow {
  department: string
  pct: number
}

function colorForPct(pct: number): string {
  if (pct >= 90) return 'bg-apple-green'
  if (pct >= 70) return 'bg-apple-orange'
  return 'bg-apple-red'
}

export function SlaHeatmap({ rows }: { rows: SlaHeatmapRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.department} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-muted-foreground">{row.department}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-[width] duration-300 ease-spring', colorForPct(row.pct))}
              style={{ width: `${Math.max(0, Math.min(100, row.pct))}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{Math.round(row.pct)}%</span>
        </div>
      ))}
    </div>
  )
}
