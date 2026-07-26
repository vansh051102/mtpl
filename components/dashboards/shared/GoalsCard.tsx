import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from './EmptyState'

export interface GoalRow {
  department: string
  metric: string
  targetValue: string | number
  achievedValue: number
  achievedPct: number
}

export function GoalsCard({ goals }: { goals: GoalRow[] }) {
  return (
    <Card className="rounded-3xl shadow-apple-card">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">Business Goals</CardTitle>
      </CardHeader>
      <CardContent>
        {goals.length === 0 ? (
          <EmptyState message="No goals set for this month yet." />
        ) : (
          <ul className="space-y-3">
            {goals.map((g) => (
              <li key={`${g.department}-${g.metric}`}>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">
                    {g.department} — {g.metric}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{Math.round(g.achievedPct)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-apple-blue transition-[width] duration-300 ease-spring"
                    style={{ width: `${Math.max(0, Math.min(100, g.achievedPct))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
