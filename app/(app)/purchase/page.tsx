'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageSkeleton } from '@/components/ui/skeleton-variants'

interface PurchaseRequestRow {
  id: string
  prNumber: string
  status: string
  estimatedAmount: string | number
  sentToSupplierAt: string | null
  createdAt: string
  lead: { id: string; companyName: string }
}

const STATUS_VARIANT: Record<string, 'destructive' | 'warning' | 'default'> = {
  pending: 'warning',
  sent_to_supplier: 'default',
  received: 'default',
  approved: 'default',
}

export default function PurchasePage() {
  const [items, setItems] = useState<PurchaseRequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<PurchaseRequestRow[]>('/purchase-requests?limit=50')
      .then((res) => {
        if (!cancelled) setItems(res.data ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load purchase requests')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="p-6 text-sm text-destructive" role="alert">
        {error}
      </div>
    )
  }

  if (!items) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <PageSkeleton />
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-display font-semibold text-foreground">Purchase</h1>
      <Card className="rounded-3xl shadow-apple-card">
        <CardHeader>
          <CardTitle>Purchase Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No purchase requests yet. All quiet on the purchase side.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((pr) => (
                <li key={pr.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/leads/${pr.lead.id}`} className="font-medium text-foreground hover:underline">
                      {pr.prNumber} — {pr.lead.companyName}
                    </Link>
                    <p className="text-sm text-muted-foreground">₹{Number(pr.estimatedAmount).toLocaleString('en-IN')}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[pr.status] ?? 'default'}>{pr.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
