import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from './EmptyState'

export interface CalendarItem {
  id: string
  title: string
  dueAt: string
  type: string
}

export function CalendarWidget({ items }: { items: CalendarItem[] }) {
  return (
    <Card className="rounded-3xl shadow-apple-card">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">Today</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState message="Nothing due today." />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-foreground">{item.title}</span>
                <span className="tabular-nums text-muted-foreground">
                  {new Date(item.dueAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
