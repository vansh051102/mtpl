import { TrendArrow } from './TrendArrow'

export interface DepartmentComparisonEntry {
  department: string
  score: number
  deltaPct: number
}

export function DepartmentComparisonRow({ entries }: { entries: DepartmentComparisonEntry[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {entries.map((e) => (
        <li key={e.department} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-foreground">{e.department}</span>
          <span className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-foreground">{Math.round(e.score)}</span>
            <TrendArrow deltaPct={e.deltaPct} />
          </span>
        </li>
      ))}
    </ul>
  )
}
