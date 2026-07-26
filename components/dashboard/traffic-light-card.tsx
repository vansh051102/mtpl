import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const HEALTH_DOT: Record<string, string> = {
  GREEN: 'bg-success',
  YELLOW: 'bg-warning',
  RED: 'bg-destructive',
}

interface TrafficLightCardProps {
  department: string
  health: string
  score: number
  metrics?: Record<string, unknown>
}

/** Standardized GREEN/YELLOW/RED department health card for the CEO Command Center. */
export function TrafficLightCard({ department, health, score, metrics }: TrafficLightCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">{department}</CardTitle>
        <span
          className={cn('h-3 w-3 shrink-0 rounded-full', HEALTH_DOT[health] ?? 'bg-muted')}
          aria-label={`${department} health: ${health}`}
        />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums text-foreground">{Math.round(score)}</p>
        {metrics && (
          <dl className="mt-2 flex flex-col gap-0.5">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="flex justify-between text-xs text-muted-foreground">
                <dt>{key}</dt>
                <dd className="tabular-nums">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
