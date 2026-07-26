import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from './EmptyState'
import type { ActivityFeedItem } from '@/lib/activity-feed'

const KIND_DOT: Record<ActivityFeedItem['kind'], string> = {
  stage_change: 'bg-apple-blue',
  sla_breach: 'bg-apple-red',
  quote_sent: 'bg-apple-orange',
  quote_accepted: 'bg-apple-green',
  rfq_sent: 'bg-apple-blue',
}

export function ActivityTimeline({ items }: { items: ActivityFeedItem[] }) {
  return (
    <Card className="rounded-3xl shadow-apple-card">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState message="No activity yet today." />
        ) : (
          <ol className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3">
                <span className="mt-1.5 flex flex-col items-center">
                  <span className={`h-2 w-2 rounded-full ${KIND_DOT[item.kind]}`} />
                </span>
                <div>
                  <p className="text-sm text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
