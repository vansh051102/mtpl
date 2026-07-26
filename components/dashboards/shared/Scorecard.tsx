import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface ScorecardField {
  label: string
  value: string | number | null
}

interface ScorecardProps {
  title: string
  fields: ScorecardField[]
}

/** Same layout for every department — Sales/LeadGen/Purchase all render through this. */
export function Scorecard({ title, fields }: ScorecardProps) {
  return (
    <Card className="rounded-3xl shadow-apple-card transition-shadow duration-300 ease-spring hover:shadow-apple-float">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">{f.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
