'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { useEscapeKey } from '@/lib/use-escape-key'
import {
  LeadDetailPanel,
  type LeadDetailData,
  type SubTab,
} from '@/components/lead-detail-panel'
import type { LeadRow } from '@/components/leads-table'
import { DrawerHeaderSkeleton } from '@/components/ui/skeleton-variants'

function seedFromRow(row: LeadRow): LeadDetailData {
  return {
    id: row.id,
    companyName: row.companyName,
    stage: row.stage,
    priority: row.priority,
    status: 'open',
    notes: null,
    requirement: null,
    source: row.source ?? null,
    slaDeadline: row.slaDeadline ?? new Date().toISOString(),
    slaBreached: row.slaBreached,
    createdAt: row.createdAt,
    assignedToId: row.assignedToId ?? row.assignedTo?.id ?? null,
    contact: row.contact
      ? {
          id: row.contact.id,
          firstName: row.contact.firstName,
          lastName: row.contact.lastName,
          email: row.contact.email,
          phone: row.contact.phone ?? '',
        }
      : null,
    assignedTo: row.assignedTo
      ? { fullName: row.assignedTo.fullName, email: '' }
      : null,
    createdBy: row.createdBy ? { fullName: row.createdBy.fullName } : null,
    supplierMargin: null,
    quotationNumber: row.quotationNumber ?? null,
    productCategory: null,
    quotationValue: null,
    activities: [],
    timeline: null,
    quotes: row.latestQuote
      ? [
          {
            id: row.latestQuote.id,
            quoteNumber: row.latestQuote.quoteNumber,
            status: row.latestQuote.status,
            finalAmount: '0',
            validUntil: new Date().toISOString(),
          },
        ]
      : [],
  }
}

// Right-side slide-over that loads a lead and renders the full detail panel.
// Opened from the leads list; closes on backdrop click or Escape.
export function LeadDetailDrawer({
  leadId,
  seed,
  onClose,
  onChanged,
  initialView,
  initialTab,
  openQuoteForm,
}: {
  leadId: string
  /** Instant paint from the list row while the full detail request completes. */
  seed?: LeadRow | null
  onClose: () => void
  // Called after any mutation so the underlying list can refresh.
  onChanged?: () => void
  // Which view/sub-tab to open on (set by the leads-list row quick-actions).
  initialView?: 'lead' | 'quotation'
  initialTab?: SubTab
  openQuoteForm?: boolean
}) {
  const [lead, setLead] = useState<LeadDetailData | null>(() =>
    seed ? seedFromRow(seed) : null
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!seed)

  const load = useCallback(async () => {
    try {
      const res = await api.get<LeadDetailData>(`/leads/${leadId}`)
      setLead(res.data ?? null)
      setError(null)
    } catch (err) {
      // Keep seed UI if we already painted from the list row.
      if (!seed) {
        setError(err instanceof ApiError ? err.message : 'Failed to load lead')
      }
    } finally {
      setLoading(false)
    }
  }, [leadId, seed])

  useEffect(() => {
    setLead(seed ? seedFromRow(seed) : null)
    setLoading(!seed)
    setError(null)
    void load()
  }, [leadId, seed, load])

  // Shared LIFO Escape stack — a reason modal opened over the drawer closes
  // alone; a second Escape then closes the drawer.
  useEscapeKey(onClose)

  const handleChanged = useCallback(() => {
    void load()
    onChanged?.()
  }, [load, onChanged])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
        className="animate-slide-in-right relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-card shadow-2xl"
        {...(loading && !lead && {
          'role': 'status',
          'aria-live': 'polite',
          'aria-busy': 'true',
          'aria-label': 'Loading lead',
        })}
      >
        {loading && !lead ? (
          <>
            <DrawerHeaderSkeleton />
            <span className="sr-only">Loading lead...</span>
          </>
        ) : error && !lead ? (
          <p className="p-6 text-sm text-destructive">{error}</p>
        ) : lead ? (
          <LeadDetailPanel
            lead={lead}
            onChanged={handleChanged}
            onClose={onClose}
            initialView={initialView}
            initialTab={initialTab}
            openQuoteForm={openQuoteForm}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Lead not found.</p>
        )}
      </div>
    </div>
  )
}
