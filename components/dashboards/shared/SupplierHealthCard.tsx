import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from './EmptyState'

export interface SupplierRow {
  id: string
  name: string
  rating: string | number
  paymentTerms: string | null
  city: string
}

/** Thin by design — see CustomerHealthCard note. Delivery%/response-time need
 * PurchaseOrder reconnected to this schema, not fabricated here. */
export function SupplierHealthCard({ suppliers }: { suppliers: SupplierRow[] }) {
  return (
    <Card className="rounded-3xl shadow-apple-card">
      <CardHeader>
        <CardTitle className="font-display text-base text-foreground">Top Suppliers</CardTitle>
      </CardHeader>
      <CardContent>
        {suppliers.length === 0 ? (
          <EmptyState message="No active suppliers yet." />
        ) : (
          <ul className="divide-y divide-border">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.city}{s.paymentTerms ? ` · ${s.paymentTerms}` : ''}</p>
                </div>
                <span className="tabular-nums text-foreground">★ {Number(s.rating).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
