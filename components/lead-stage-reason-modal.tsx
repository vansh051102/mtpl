'use client'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { reasonsForStage } from '@/lib/lead-stages'
import { cn } from '@/lib/utils'

const MIN_OTHER_DETAILS_LENGTH = 20

interface Props {
  leadId: string
  // The loss stage being entered: "Deal Lost" or "Disqualified".
  targetStage: 'Deal Lost' | 'Disqualified'
  onClose: () => void
  onDone: () => void
}

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

// Modal that captures the macro reason (controlled list) + micro details
// (free text) when moving a lead to Deal Lost or Disqualified. Mirrors the
// a reference competitor's Stage: Deal Lost / Disqualified dialogs.
export function LeadStageReasonModal({ leadId, targetStage, onClose, onDone }: Props) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reasons = reasonsForStage(targetStage)

  const detailsRequired = reason === 'Other'
  const detailsTooShort = detailsRequired && details.trim().length < MIN_OTHER_DETAILS_LENGTH

  async function handleSave() {
    if (!reason) return
    if (detailsTooShort) {
      setError(`Details must be at least ${MIN_OTHER_DETAILS_LENGTH} characters`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.put(`/leads/${leadId}/stage`, {
        stage: targetStage,
        reason,
        reasonDetails: details.trim() || undefined,
      })
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update stage')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Stage: ${targetStage}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {targetStage === 'Deal Lost'
            ? 'Please provide the reason this deal was lost.'
            : 'Please provide the reason for disqualification.'}
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="loss-reason" className="text-xs font-medium text-muted-foreground">
            Reason (required)
          </label>
          <select
            id="loss-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a reason…</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="loss-details" className="text-xs font-medium text-muted-foreground">
            Details {detailsRequired ? `(required, min ${MIN_OTHER_DETAILS_LENGTH} characters)` : '(optional)'}
          </label>
          <textarea
            id="loss-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            placeholder="Add specifics for the sales team (e.g. customer asked for ₹65/unit)…"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSave}
            disabled={!reason || saving || detailsTooShort}
            className={cn(saving && 'opacity-60 disabled:cursor-not-allowed')}
          >
            {`Move to ${targetStage}`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
