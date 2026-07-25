'use client'

import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { StatusPill } from '@/components/ui/status-pill'
import { LeadTimeline, type TimelineEvent } from '@/components/lead-timeline'
import { formatCurrency } from '@/lib/utils'
import { ModalContentSkeleton } from '@/components/ui/skeleton-variants'

interface ContactDetail {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  gstNumber: string | null
  city: string | null
  leads: {
    id: string
    companyName: string
    stage: string
    createdAt: string
    timeline: { events: TimelineEvent[] } | null
  }[]
}

interface LtvResult {
  ltv: number
  acceptedQuoteCount: number
}

export function Lead360Modal({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [ltv, setLtv] = useState<LtvResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      api.get<ContactDetail>(`/contacts/${contactId}`),
      api.get<LtvResult>(`/contacts/${contactId}/ltv`),
    ])
      .then(([contactRes, ltvRes]) => {
        if (cancelled) return
        setContact(contactRes.data ?? null)
        setLtv(ltvRes.data ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Failed to load contact')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contactId])

  const allEvents = contact?.leads.flatMap((l) => l.timeline?.events ?? []) ?? []

  return (
    <Modal title={contact ? `${contact.firstName} ${contact.lastName}` : 'Contact 360'} onClose={onClose} size="lg">
      {loading && <ModalContentSkeleton variant="list" />}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {contact && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-medium">{contact.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-medium">{contact.phone}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GST</p>
              <p className="font-medium">{contact.gstNumber || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">City</p>
              <p className="font-medium">{contact.city || '—'}</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Lifetime value (accepted quotes)</p>
            <p className="text-xl font-semibold">{formatCurrency(ltv?.ltv ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{ltv?.acceptedQuoteCount ?? 0} accepted quote(s)</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Leads ({contact.leads.length})</h3>
            <ul className="flex flex-col gap-1.5">
              {contact.leads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium">{lead.companyName}</span>
                  <StatusPill kind="stage" value={lead.stage} />
                </li>
              ))}
              {contact.leads.length === 0 && (
                <p className="text-sm text-muted-foreground">No leads for this contact yet.</p>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Full timeline</h3>
            <LeadTimeline events={allEvents} />
          </div>
        </div>
      )}
    </Modal>
  )
}
