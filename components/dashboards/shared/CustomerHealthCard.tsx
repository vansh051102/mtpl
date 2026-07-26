import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from './EmptyState'

export interface CustomerRow {
  id: string
  name: string
  type: string
  creditLimit: string | number
  city: string
}

/** Deliberately thin: Customer isn't linked to Lead/Quote/Invoice in this schema
 * yet, so revenue/outstanding/last-order aren't derivable — see the note above
 * the Customer model in prisma/schema.prisma. Shows only real columns. */
export function CustomerHealthCard({ customers }: { customers: CustomerRow[] }) {
  return (
    <Card className="rounded-3xl shadow-apple-card">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">Top Customers</CardTitle>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <EmptyState message="No active customers yet." />
        ) : (
          <ul className="divide-y divide-border">
            {customers.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.city}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{c.type}</Badge>
                  <span className="tabular-nums text-foreground">₹{Number(c.creditLimit).toLocaleString('en-IN')}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
