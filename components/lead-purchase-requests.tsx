'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'

interface PurchaseRequest {
  id: string
  prNumber: string
  status: string
  estimatedAmount: string
  estimatedQuantity: number
}

const PR_STATUSES = ['pending', 'sent_to_supplier', 'received', 'approved'] as const

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success'> = {
  pending: 'default',
  sent_to_supplier: 'warning',
  received: 'warning',
  approved: 'success',
}

export function LeadPurchaseRequests({
  leadId,
  purchaseRequests,
  onChanged,
  renderActions,
}: {
  leadId: string
  purchaseRequests: PurchaseRequest[]
  onChanged: () => void
  renderActions?: (onShow: () => void) => React.ReactNode
}) {
  const [showForm, setShowForm] = useState(false)
  const [productIds, setProductIds] = useState('')
  const [estimatedQuantity, setEstimatedQuantity] = useState('')
  const [estimatedAmount, setEstimatedAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const ids = productIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (ids.length === 0 || !estimatedQuantity || !estimatedAmount) {
      setError('Product IDs, quantity, and amount are required')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/leads/${leadId}/purchase-requests`, {
        productIds: ids,
        estimatedQuantity: Number(estimatedQuantity),
        estimatedAmount: Number(estimatedAmount),
      })
      setShowForm(false)
      setProductIds('')
      setEstimatedQuantity('')
      setEstimatedAmount('')
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create purchase request')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(prId: string, status: string) {
    setUpdatingId(prId)
    setError(null)
    try {
      await api.put(`/purchase-requests/${prId}`, { status })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status')
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {purchaseRequests.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No purchase requests yet.</p>
      )}

      {purchaseRequests.map((pr) => (
        <div key={pr.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <div>
            <p className="font-medium">{pr.prNumber}</p>
            <p className="text-muted-foreground">
              Qty {pr.estimatedQuantity} · {formatCurrency(Number(pr.estimatedAmount))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[pr.status] || 'default'}>{pr.status}</Badge>
            <select
              value={pr.status}
              disabled={updatingId === pr.id}
              onChange={(e) => handleStatusChange(pr.id, e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary"
            >
              {PR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      {showForm ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Product IDs (comma-separated)</label>
              <input
                value={productIds}
                onChange={(e) => setProductIds(e.target.value)}
                placeholder="e.g. MS-PIPE-40, HR-COIL-2MM"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Estimated quantity</label>
                <input
                  type="number"
                  value={estimatedQuantity}
                  onChange={(e) => setEstimatedQuantity(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Estimated amount</label>
                <input
                  type="number"
                  value={estimatedAmount}
                  onChange={(e) => setEstimatedAmount(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Create request
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
      ) : (
        renderActions ? (
          renderActions(() => setShowForm(true))
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            New purchase request
          </Button>
        )
      )}
    </div>
  )
}
