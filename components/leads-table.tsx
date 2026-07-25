'use client'

import { Fragment, useRef, useState } from 'react'
import { Hand, Phone, MessageSquare, BellRing } from 'lucide-react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { otherStages, nextValidStages, isOutOfSequence } from '@/lib/lead-stages'
import { LEAD_PRIORITIES } from '@/lib/validation'
import { getLeadDepartment } from '@/lib/lead-department'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { statusPillClass } from '@/components/ui/status-pill'
import { useToast } from '@/components/ui/toast'
import { cn, formatDate } from '@/lib/utils'
import { LeadDetailDrawer } from '@/components/lead-detail-drawer'
import { LeadActivityPopover, type PopoverAnchor } from '@/components/lead-activity-popover'
import type { SubTab } from '@/components/lead-detail-panel'

export interface LeadRow {
  id: string
  companyName: string
  stage: string
  priority: string
  slaBreached: boolean
  slaDeadline?: string | null
  createdAt: string
  lastActivityAt: string
  contact: { id: string; firstName: string; lastName: string; email: string; phone?: string | null } | null
  assignedTo: { id?: string; fullName: string } | null
  assignedToId?: string | null
  createdBy?: { id: string; fullName: string } | null
  source?: string | null
  hasQuote?: boolean
  latestQuote?: { id: string; quoteNumber: string; status: string } | null
  lastActivityLabel?: string | null
  stageDetails?: string | null
  quotationNumber?: string | null
  purchaseRequests?: { status: string }[]
  targetClosingDate?: string | null
}

type DrawerTarget = {
  id: string
  seed?: LeadRow
  view?: 'lead' | 'quotation'
  tab?: SubTab
  /** Open the quote create form (Create Quote only — not View Quote). */
  openQuoteForm?: boolean
}

export interface OrgUser {
  id: string
  fullName: string
}

export type SortBy =
  | 'createdAt'
  | 'companyName'
  | 'priority'
  | 'stage'
  | 'lastActivityAt'
  | 'slaDeadline'
  | 'quotationValue'
  | 'orderValue'
  | 'supplierMargin'
  | 'totalCalls'
  | 'totalMessages'
export type SortDir = 'asc' | 'desc'

/** @deprecated prefer StatusPill — kept for kanban Badge variants */
export const PRIORITY_VARIANT: Record<string, 'default' | 'warning' | 'destructive'> = {
  Low: 'default',
  Medium: 'default',
  High: 'warning',
  Urgent: 'destructive',
}

export const STAGE_VARIANT: Record<
  string,
  'default' | 'primary' | 'success' | 'warning' | 'destructive'
> = {
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

const pillSelectClass =
  'h-7 max-w-[130px] cursor-pointer appearance-none rounded-md border-0 px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-ring'

const iconBtnClass = 'crm-icon-btn'

function shortDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function SourceGlyph({ source }: { source?: string | null }) {
  const isIndiaMart = Boolean(source && /indiamart/i.test(source))
  if (isIndiaMart) {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-[10px] font-bold text-red-600"
        title="IndiaMART"
        aria-label="IndiaMART"
      >
        IM
      </span>
    )
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      title={source || 'Added manually'}
      aria-label={source || 'Added manually'}
    >
      <Hand className="h-3.5 w-3.5" />
    </span>
  )
}

interface LeadsTableProps {
  data: LeadRow[]
  users: OrgUser[]
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onChanged: () => void
  sortBy: SortBy
  sortDir: SortDir
  onSort: (column: SortBy) => void
  isPending?: boolean
}

export function LeadsTable({
  data,
  users,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onChanged,
  isPending,
}: LeadsTableProps) {
  const { toast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [pendingStageChange, setPendingStageChange] = useState<{ leadId: string; stage: string } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [hoveredLeadId, setHoveredLeadId] = useState<string | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<PopoverAnchor | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredLead = hoveredLeadId ? data.find((l) => l.id === hoveredLeadId) : null

  const allSelected = data.length > 0 && data.every((l) => selected.has(l.id))

  function openLead(
    lead: LeadRow | string,
    opts?: { view?: 'lead' | 'quotation'; tab?: SubTab; openQuoteForm?: boolean }
  ) {
    handleRowLeave()
    if (typeof lead === 'string') {
      setDrawer({ id: lead, ...opts })
      return
    }
    setDrawer({ id: lead.id, seed: lead, ...opts })
  }

  function handleRowEnter(id: string, x: number, y: number) {
    hoverTimer.current = setTimeout(() => {
      setHoveredLeadId(id)
      setPopoverAnchor({ x, y })
    }, 350)
  }

  function handleRowLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoveredLeadId(null)
    setPopoverAnchor(null)
  }

  async function inlineUpdate(lead: LeadRow, fn: () => Promise<unknown>, successMsg: string) {
    setBusyId(lead.id)
    try {
      await fn()
      toast(successMsg)
      onChanged()
    } catch (err) {
      toast(toFormErrors(err, 'Update failed').message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  function changeStage(lead: LeadRow, stage: string, reason?: string) {
    inlineUpdate(
      lead,
      () => api.put(`/leads/${lead.id}/stage`, { stage, ...(reason && { reason }) }),
      `Moved to ${stage}`
    )
  }

  function changePriority(lead: LeadRow, priority: string) {
    inlineUpdate(lead, () => api.put(`/leads/${lead.id}`, { priority }), `Priority: ${priority}`)
  }

  function changeAssignee(lead: LeadRow, assignedToId: string) {
    inlineUpdate(lead, () => api.put(`/leads/${lead.id}/assign`, { assignedToId }), 'Lead reassigned')
  }

  function changeFollowUpDate(lead: LeadRow, targetClosingDate: string) {
    inlineUpdate(
      lead,
      () => api.put(`/leads/${lead.id}`, { targetClosingDate: targetClosingDate || null }),
      'Follow-up date updated'
    )
  }

  // In-sequence options come from the same SOP graph the full stage-change
  // form (lead-stage-control.tsx) enforces — picking one of these always
  // succeeds. Everything else offered here is an out-of-sequence jump,
  // which the backend accepts but only with a reason (see pendingStageChange).
  function inlineStageOptions(stage: string): { inSequence: string[]; outOfSequence: string[] } {
    const allOffered = otherStages(stage).filter((s) => s !== 'Deal Lost' && s !== 'Disqualified')
    const inSequence = nextValidStages(stage).filter((s) => allOffered.includes(s))
    const outOfSequence = allOffered.filter((s) => !inSequence.includes(s))
    return { inSequence, outOfSequence }
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        No leads match these filters.
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2 md:hidden">
        {data.map((lead) => (
          <button
            key={lead.id}
            onClick={() => openLead(lead)}
            className="rounded-lg border border-border bg-card p-3 text-left hover:bg-muted"
          >
            <div className="flex items-center gap-2">
              <SourceGlyph source={lead.source} />
              <span className="font-medium">{lead.companyName || 'Unnamed lead'}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {lead.contact
                ? `${lead.contact.firstName} ${lead.contact.lastName}`
                : 'No contact'}{' '}
              · {lead.assignedTo?.fullName || 'Unassigned'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', statusPillClass('stage', lead.stage))}>
                {lead.stage}
              </span>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium',
                  statusPillClass('priority', lead.priority || 'Unassigned')
                )}
              >
                {lead.priority || 'Unassigned'}
              </span>
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="sticky top-0 z-20 border-b border-border bg-card text-left text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-20 w-10 bg-card px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all visible leads"
                  className="h-4 w-4 rounded border-border"
                />
              </th>
              <th className="sticky left-10 z-20 min-w-[200px] whitespace-nowrap bg-card px-3 py-2.5 font-medium">
                Source & Lead
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Contact</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Stage</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Department</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Stage details</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Priority</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Assigned to</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Follow-up</th>
              <th className="whitespace-nowrap px-3 py-2.5 font-medium">Last activity</th>
              <th className="sticky right-0 z-20 whitespace-nowrap bg-card px-3 py-2.5 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((lead) => {
              const { inSequence, outOfSequence } = inlineStageOptions(lead.stage)
              const stageOptions = [...inSequence, ...outOfSequence]
              const isPendingThisLead = pendingStageChange?.leadId === lead.id
              const busy = busyId === lead.id
              const priorityValue = lead.priority || 'Unassigned'
              const activityLabel = lead.lastActivityLabel || 'Updated'
              const displayName = lead.companyName?.trim() || 'Unnamed lead'

              return (
                <Fragment key={lead.id}>
                <tr
                  className="border-t border-border hover:bg-muted/40"
                  onMouseEnter={(e) => handleRowEnter(lead.id, e.clientX, e.clientY)}
                  onMouseLeave={handleRowLeave}
                >
                  <td className="crm-table-cell sticky left-0 z-10 bg-card">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => onToggleSelect(lead.id)}
                      aria-label={`Select ${displayName}`}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                  <td className="crm-table-cell sticky left-10 z-10 min-w-[200px] bg-card">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setExpandedRowId((id) => (id === lead.id ? null : lead.id))}
                        aria-label={expandedRowId === lead.id ? `Collapse ${displayName}` : `Expand ${displayName}`}
                        aria-expanded={expandedRowId === lead.id}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <span className={cn('inline-block transition-transform', expandedRowId === lead.id && 'rotate-90')}>
                          ▶
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openLead(lead)}
                        className="flex items-center gap-2 text-left"
                      >
                        <SourceGlyph source={lead.source} />
                        <span className="font-medium text-foreground hover:underline">{displayName}</span>
                      </button>
                    </div>
                  </td>
                  <td className="crm-table-cell">
                    {lead.contact ? (
                      <div className="flex min-w-[140px] flex-col leading-snug">
                        <span className="font-medium">
                          {lead.contact.firstName} {lead.contact.lastName}
                        </span>
                        {lead.contact.phone && (
                          <span className="text-xs text-muted-foreground">{lead.contact.phone}</span>
                        )}
                        {lead.contact.email && (
                          <span className="max-w-[180px] truncate text-xs text-muted-foreground">
                            {lead.contact.email}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="crm-table-cell">
                    <div className="flex min-w-[120px] flex-col gap-0.5">
                      {stageOptions.length === 0 ? (
                        <span
                          className={cn(
                            'inline-flex w-fit rounded-md px-2 py-0.5 text-xs font-medium',
                            statusPillClass('stage', lead.stage)
                          )}
                        >
                          {lead.stage}
                        </span>
                      ) : (
                        <select
                          value={lead.stage}
                          disabled={busy}
                          onChange={(e) => {
                            const stage = e.target.value
                            if (isOutOfSequence(lead.stage, stage)) {
                              setPendingReason('')
                              setPendingStageChange({ leadId: lead.id, stage })
                            } else {
                              changeStage(lead, stage)
                            }
                          }}
                          aria-label={`Stage for ${displayName}`}
                          className={cn(pillSelectClass, statusPillClass('stage', lead.stage))}
                        >
                          <option value={lead.stage}>{lead.stage}</option>
                          {inSequence.length > 0 && (
                            <optgroup label="Next steps">
                              {inSequence.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {outOfSequence.length > 0 && (
                            <optgroup label="Skip sequence (reason required)">
                              {outOfSequence.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      )}
                      {isPendingThisLead && (
                        <div className="flex flex-col gap-1 rounded-md border border-amber-400/50 bg-amber-50 p-1.5 dark:bg-amber-950/30">
                          <span className="text-[11px] text-amber-800 dark:text-amber-300">
                            Skipping to {pendingStageChange.stage} — reason required
                          </span>
                          <input
                            autoFocus
                            value={pendingReason}
                            onChange={(e) => setPendingReason(e.target.value)}
                            placeholder="Reason…"
                            className="h-6 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={!pendingReason.trim()}
                              onClick={() => {
                                changeStage(lead, pendingStageChange.stage, pendingReason.trim())
                                setPendingStageChange(null)
                              }}
                              className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingStageChange(null)}
                              className="rounded border border-border px-1.5 py-0.5 text-[11px]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      <span className="text-[11px] text-muted-foreground">• {activityLabel}</span>
                    </div>
                  </td>
                  <td className="crm-table-cell">
                    <Badge variant="default">{getLeadDepartment(lead)}</Badge>
                  </td>
                  <td className="crm-table-cell">
                    <span className="text-muted-foreground">{lead.stageDetails || 'No stage details'}</span>
                  </td>
                  <td className="crm-table-cell">
                    <select
                      value={lead.priority || ''}
                      disabled={busy}
                      onChange={(e) => changePriority(lead, e.target.value)}
                      aria-label={`Priority for ${displayName}`}
                      className={cn(pillSelectClass, statusPillClass('priority', priorityValue))}
                    >
                      <option value="">Unassigned</option>
                      {LEAD_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="crm-table-cell">
                    <select
                      value={lead.assignedToId || lead.assignedTo?.id || ''}
                      disabled={busy}
                      onChange={(e) => e.target.value && changeAssignee(lead, e.target.value)}
                      aria-label={`Assignee for ${displayName}`}
                      className="h-7 max-w-[140px] rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="crm-table-cell">
                    <input
                      type="date"
                      value={lead.targetClosingDate ? lead.targetClosingDate.slice(0, 10) : ''}
                      disabled={busy}
                      onChange={(e) => changeFollowUpDate(lead, e.target.value)}
                      aria-label={`Follow-up date for ${displayName}`}
                      className="h-7 w-[130px] rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                  </td>
                  <td className="crm-table-cell">
                    <div className="flex min-w-[140px] flex-col gap-1">
                      <span className="text-muted-foreground">
                        {activityLabel}: {shortDate(lead.lastActivityAt)}
                      </span>
                      {lead.slaBreached ? (
                        <Badge variant="destructive">SLA breached</Badge>
                      ) : lead.slaDeadline ? (
                        <Badge variant="default">Due {formatDate(lead.slaDeadline)}</Badge>
                      ) : (
                        <Badge variant="default">No SLA</Badge>
                      )}
                    </div>
                  </td>
                  <td className="crm-table-cell sticky right-0 z-10 bg-card">
                    <div className="flex flex-col items-end gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          openLead(lead, {
                            view: 'quotation',
                            openQuoteForm: !lead.hasQuote,
                          })
                        }
                        className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        {lead.hasQuote ? 'View Quote' : 'Create Quote'}
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openLead(lead, { view: 'lead', tab: 'calls' })}
                          className={iconBtnClass}
                          aria-label="Call Log"
                          title="Call Log"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openLead(lead, { view: 'lead', tab: 'messages' })}
                          className={iconBtnClass}
                          aria-label="Log Message"
                          title="Log Message"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openLead(lead, { view: 'lead', tab: 'reminders' })}
                          className={iconBtnClass}
                          aria-label="Reminder"
                          title="Reminder"
                        >
                          <BellRing className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
                {expandedRowId === lead.id && (
                  <tr className="border-t border-border bg-muted/20">
                    {/* Uses the row's already-fetched data — no second fetch;
                        the drawer (opened via the company-name button) remains
                        the full detail view. */}
                    <td colSpan={11} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-x-8 gap-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Contact</p>
                          <p>
                            {lead.contact
                              ? `${lead.contact.firstName} ${lead.contact.lastName} · ${lead.contact.email || lead.contact.phone || '—'}`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Latest quote</p>
                          <p>
                            {lead.latestQuote
                              ? `${lead.latestQuote.quoteNumber} (${lead.latestQuote.status})`
                              : lead.quotationNumber || 'None'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Stage details</p>
                          <p>{lead.stageDetails || 'No stage details'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Recent activity</p>
                          <p>{activityLabel}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openLead(lead)}>
                          Open full detail
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
            {isPending && Array.from({ length: data.length || 10 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-t border-border">
                <td className="crm-table-cell w-10"><Skeleton className="h-4 w-4 rounded" /></td>
                <td className="crm-table-cell"><Skeleton className="h-4 w-36" /></td>
                <td className="crm-table-cell"><Skeleton className="h-3.5 w-28" /></td>
                <td className="crm-table-cell"><Skeleton className="h-7 w-24 rounded-md" /></td>
                <td className="crm-table-cell"><Skeleton className="h-3.5 w-32" /></td>
                <td className="crm-table-cell"><Skeleton className="h-7 w-20 rounded-md" /></td>
                <td className="crm-table-cell"><Skeleton className="h-7 w-28 rounded-md" /></td>
                <td className="crm-table-cell"><Skeleton className="h-7 w-28 rounded-md" /></td>
                <td className="crm-table-cell"><div className="flex gap-1"><Skeleton className="h-7 w-7 rounded-md" /><Skeleton className="h-7 w-7 rounded-md" /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer && (
        <LeadDetailDrawer
          leadId={drawer.id}
          seed={drawer.seed}
          initialView={drawer.view}
          initialTab={drawer.tab}
          openQuoteForm={drawer.openQuoteForm}
          onClose={() => setDrawer(null)}
          onChanged={onChanged}
        />
      )}

      <LeadActivityPopover
        leadId={hoveredLeadId}
        anchor={popoverAnchor}
        preview={
          hoveredLead
            ? {
                companyName: hoveredLead.companyName,
                label: hoveredLead.lastActivityLabel,
                at: hoveredLead.lastActivityAt,
                stageDetails: hoveredLead.stageDetails,
              }
            : null
        }
      />
    </>
  )
}
