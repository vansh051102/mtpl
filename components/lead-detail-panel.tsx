'use client'

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { useHasPermission } from '@/lib/use-current-user'
import { LEAD_PRIORITIES } from '@/lib/validation'
import { formatDate, isSlaOverdue } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { LeadAssignControl } from '@/components/lead-assign-control'
import { LeadQuotes } from '@/components/lead-quotes'
import { LeadStageControl } from '@/components/lead-stage-control'
import { LeadActivityTab, type LeadActivity } from '@/components/log-activity-forms'
import { LeadDocuments } from '@/components/lead-documents'
import { LeadTimeline, type TimelineEvent } from '@/components/lead-timeline'
import { Lead360Modal } from '@/components/leads/lead-360-modal'

export interface LeadDetailData {
  id: string
  companyName: string
  stage: string
  priority: string
  status: string
  notes: string | null
  requirement: string | null
  source: string | null
  slaDeadline: string
  slaBreached: boolean
  createdAt: string
  updatedAt?: string
  assignedToId: string | null
  contact: { id: string; firstName: string; lastName: string; email: string; phone: string } | null
  assignedTo: { fullName: string; email: string } | null
  createdBy: { fullName: string } | null
  // Quote Sent details
  supplierMargin: number | null
  quotationNumber: string | null
  productCategory: string | null
  quotationValue: number | null
  activities: LeadActivity[]
  timeline: { events: TimelineEvent[] } | null
  quotes: {
    id: string
    quoteNumber: string
    status: string
    finalAmount: string
    validUntil: string
  }[]
}

export type SubTab = 'requirements' | 'calls' | 'messages' | 'reminders' | 'documents' | 'timeline'

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'calls', label: 'Call Logs' },
  { key: 'messages', label: 'Messages' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'documents', label: 'Documents' },
  { key: 'timeline', label: 'Timeline' },
]

const controlClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

const STAGE_BADGE: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'destructive'> = {
  'New Lead': 'default',
  Contacted: 'primary',
  Qualified: 'primary',
  'Quote Sent': 'warning',
  'Order Confirmed': 'success',
  'Order Closed': 'success',
  'Closed Won': 'success',
  'Deal Lost': 'destructive',
  Disqualified: 'destructive',
}

// The full per-lead workspace: top controls, contact row, Lead/Quotation
// toggle, and the six Lead sub-tabs. Shared by the slide-over drawer and the
// full-page /leads/[id] route.
export function LeadDetailPanel({
  lead,
  onChanged,
  onClose,
  initialView = 'lead',
  initialTab = 'requirements',
  openQuoteForm = false,
}: {
  lead: LeadDetailData
  onChanged: () => void
  onClose?: () => void
  // Deep-link the panel to a specific view/sub-tab (used by the leads-list
  // row quick-actions: call/message/reminder icons and the Create Quote button).
  initialView?: 'lead' | 'quotation'
  initialTab?: SubTab
  openQuoteForm?: boolean
}) {
  const { toast } = useToast()
  const canEdit = useHasPermission('leads:edit')
  const canCreateActivity = useHasPermission('activities:create')
  const canViewQuotes = useHasPermission('quotes:read')

  const [view, setView] = useState<'lead' | 'quotation'>(initialView)
  const [subTab, setSubTab] = useState<SubTab>(initialTab)
  const [requirement, setRequirement] = useState(lead.requirement ?? '')
  const [savingReq, setSavingReq] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show360, setShow360] = useState(false)

  const calls = useMemo(
    () =>
      lead.activities.filter(
        (a) =>
          a.type === 'call' ||
          (a.type === 'task' && (a.metadata as Record<string, unknown>)?.sop === 'QUOTE_SENT_FOLLOW_UP')
      ),
    [lead.activities]
  )
  const messages = useMemo(
    () => lead.activities.filter((a) => a.type === 'message'),
    [lead.activities]
  )
  const reminders = useMemo(
    () => lead.activities.filter((a) => a.type === 'reminder' || a.type === 'task'),
    [lead.activities]
  )

  const breached = lead.slaBreached || isSlaOverdue(lead.slaDeadline)

  async function patchLead(data: Record<string, unknown>) {
    setError(null)
    try {
      await api.put(`/leads/${lead.id}`, data)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed')
    }
  }

  async function saveRequirement() {
    setSavingReq(true)
    await patchLead({ requirement })
    setSavingReq(false)
    toast('Requirement saved')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{lead.companyName}</h2>
          <p className="text-xs text-muted-foreground">
            Created {formatDate(new Date(lead.createdAt))}
            {lead.updatedAt ? ` · Updated ${formatDate(new Date(lead.updatedAt))}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={breached ? 'destructive' : 'success'}>
            {breached ? 'SLA Breached' : `SLA ${formatDate(new Date(lead.slaDeadline))}`}
          </Badge>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Control row: Source · Priority · Stage · Assigned To */}
      <div className="grid grid-cols-2 gap-3 border-b border-border p-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Source
          </span>
          <span className="flex h-9 items-center text-sm">{lead.source || '—'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Priority
          </span>
          <select
            aria-label="Priority"
            value={lead.priority}
            disabled={!canEdit}
            onChange={(e) => patchLead({ priority: e.target.value })}
            className={controlClass}
          >
            {LEAD_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Stage
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STAGE_BADGE[lead.stage] ?? 'default'}>{lead.stage}</Badge>
            {canEdit && (
              <LeadStageControl
                leadId={lead.id}
                currentStage={lead.stage}
                onChanged={onChanged}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Assigned To
          </span>
          <LeadAssignControl
            leadId={lead.id}
            assignedToId={lead.assignedToId}
            assignedToName={lead.assignedTo?.fullName ?? null}
            onChanged={onChanged}
          />
        </div>
      </div>

      {/* Contact details */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-4 py-3 text-sm">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Contact
        </span>
        {lead.contact ? (
          <>
            <span className="font-medium">
              {lead.contact.firstName} {lead.contact.lastName}
            </span>
            {lead.contact.phone && (
              <a href={`tel:${lead.contact.phone}`} className="text-primary hover:underline">
                {lead.contact.phone}
              </a>
            )}
            {lead.contact.email && (
              <a href={`mailto:${lead.contact.email}`} className="text-primary hover:underline">
                {lead.contact.email}
              </a>
            )}
            <button
              type="button"
              onClick={() => setShow360(true)}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              View 360°
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">No contact linked</span>
        )}
      </div>

      {show360 && lead.contact && (
        <Lead360Modal contactId={lead.contact.id} onClose={() => setShow360(false)} />
      )}

      {/* Lead / Quotation toggle (fixed) — Quotation hidden without quotes:read */}
      <div className="flex flex-none gap-1 border-b border-border p-2">
        {(canViewQuotes ? (['lead', 'quotation'] as const) : (['lead'] as const)).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
              view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {v === 'lead' ? 'Lead' : 'Quotation'}
          </button>
        ))}
      </div>

      {error && <p className="flex-none px-4 pt-2 text-sm text-destructive">{error}</p>}

      {/* Sub-tabs (Lead view only, fixed) */}
      {view === 'lead' && (
        <div className="flex flex-none gap-1 overflow-x-auto border-b border-border px-2">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                subTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable content — min-h-0 lets this flex child shrink so its own
          overflow-y-auto engages instead of the whole panel overflowing. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {view === 'quotation' ? (
          <LeadQuotes
            leadId={lead.id}
            quotes={lead.quotes}
            onChanged={onChanged}
            autoOpenForm={openQuoteForm}
          />
        ) : subTab === 'requirements' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Requirements</h3>
              {canViewQuotes && (
                <Button size="sm" variant="outline" onClick={() => setView('quotation')}>
                  Create Quote
                </Button>
              )}
            </div>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              disabled={!canEdit}
              rows={8}
              placeholder="Capture the customer's requirement — products, quantities, specs, timelines…"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {canEdit && (
              <div>
                <Button
                  size="sm"
                  onClick={saveRequirement}
                  disabled={savingReq || requirement === (lead.requirement ?? '')}
                >
                  {savingReq ? 'Saving…' : 'Save requirement'}
                </Button>
              </div>
            )}

            {/* Quote Sent Details — locked after stage transition */}
            {lead.stage === 'Quote Sent' && lead.quotationNumber && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <h4 className="mb-2 text-sm font-semibold">Quote Details</h4>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Quotation Number</dt>
                  <dd className="font-medium">{lead.quotationNumber}</dd>
                  <dt className="text-muted-foreground">Product Category</dt>
                  <dd className="font-medium">{lead.productCategory}</dd>
                  <dt className="text-muted-foreground">Quotation Value</dt>
                  <dd className="font-medium">
                    {lead.quotationValue != null
                      ? `₹${Number(lead.quotationValue).toLocaleString('en-IN')}`
                      : '—'}
                  </dd>
                  <dt className="text-muted-foreground">Supplier Margin</dt>
                  <dd className="font-medium">
                    {lead.supplierMargin != null ? `${lead.supplierMargin}%` : '—'}
                  </dd>
                </dl>
              </div>
            )}
          </div>
        ) : subTab === 'calls' ? (
          <LeadActivityTab
            leadId={lead.id}
            kind="call"
            activities={calls}
            onChanged={onChanged}
            canCreate={canCreateActivity}
          />
        ) : subTab === 'messages' ? (
          <LeadActivityTab
            leadId={lead.id}
            kind="message"
            activities={messages}
            onChanged={onChanged}
            canCreate={canCreateActivity}
          />
        ) : subTab === 'reminders' ? (
          <LeadActivityTab
            leadId={lead.id}
            kind="reminder"
            activities={reminders}
            onChanged={onChanged}
            canCreate={canCreateActivity}
          />
        ) : subTab === 'documents' ? (
          <LeadDocuments leadId={lead.id} canEdit={canEdit} />
        ) : (
          <LeadTimeline events={lead.timeline?.events ?? []} />
        )}
      </div>

    </div>
  )
}
