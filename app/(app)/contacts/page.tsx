'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, Eye, Phone } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { MetricCard } from '@/components/ui/metric-card'
import { useToast } from '@/components/ui/toast'
import { PermissionGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'
import { CALL_OUTCOMES, DISQUALIFIED_REASONS } from '@/lib/lead-stages'
import { queueMutation, listQueuedMutations, removeQueuedMutation } from '@/lib/offline-queue'

const MASK_PLACEHOLDER = '••••••••'
const MIN_OTHER_DETAILS_LENGTH = 20
// The two "this didn't work out" Lead outcomes — reopening lead-gen actions
// when the linked lead lands here (vs. e.g. Order Closed, a win) is exactly
// what the Return-to-Lead-Gen manager override produces.
const LOST_LEAD_STAGES = ['Deal Lost', 'Disqualified']

interface ContactRow {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  alternatePhone: string | null
  designation: string | null
  source: string
  tags: string[]
  createdAt: string
  stage: string
  lastCallOutcome: string | null
  lastCallDate: string | null
  nextFollowupDate: string | null
  lockedByUserId: string | null
  lockedUntil: string | null
  isDncListed: boolean
  version: number
  leads: { id: string; stage: string; assignedTo: { fullName: string } | null }[]
}

interface OrgUser {
  id: string
  fullName: string
  role: string
  status: string
}

const SALES_ROLES = ['sales_executive', 'sales_manager', 'sales_purchase']

const SOURCES = ['Website', 'LinkedIn', 'Referral', 'Email', 'Phone', 'Other'] as const
const ASSIGN_TABS = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'assigned', label: 'Assigned' },
] as const

const STAGE_BADGE: Record<string, string> = {
  'New Lead': 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  Contacted: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  Disqualified: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

const inputClass =
  'h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

const QUEUE_TABS = [
  { key: 'active', label: 'My Active Queue' },
  { key: 'handedOff', label: 'Handed Off' },
] as const

// A lead in a "lost" terminal stage (incl. one sent back via the
// Return-to-Lead-Gen manager override) reopens lead-gen actions; anything
// else linked (open pipeline or won) hands the contact off to sales.
function isActiveQueueContact(c: ContactRow): boolean {
  const linkedLead = c.leads[0]
  return !linkedLead || LOST_LEAD_STAGES.includes(linkedLead.stage)
}

export default function ContactsPage() {
  const { toast } = useToast()
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [assignedFilter, setAssignedFilter] = useState<(typeof ASSIGN_TABS)[number]['key']>('all')
  const [queueTab, setQueueTab] = useState<(typeof QUEUE_TABS)[number]['key']>('active')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [salespeople, setSalespeople] = useState<OrgUser[]>([])
  const [assigningContact, setAssigningContact] = useState<ContactRow | null>(null)
  const [assignForm, setAssignForm] = useState({ companyName: '', assignedToId: '', handoffNotes: '' })
  const [assignSaving, setAssignSaving] = useState(false)

  const [callLogContact, setCallLogContact] = useState<ContactRow | null>(null)
  const [callLogForm, setCallLogForm] = useState({
    outcome: CALL_OUTCOMES[0] as (typeof CALL_OUTCOMES)[number],
    duration: '',
    notes: '',
  })
  const [callLogSaving, setCallLogSaving] = useState(false)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [reminderContact, setReminderContact] = useState<ContactRow | null>(null)
  const [reminderForm, setReminderForm] = useState({ dueDate: '', dueTime: '', note: '' })
  const [reminderSaving, setReminderSaving] = useState(false)

  const [disqualifyContact, setDisqualifyContact] = useState<ContactRow | null>(null)
  const [disqualifyForm, setDisqualifyForm] = useState({ reason: DISQUALIFIED_REASONS[0] as string, details: '' })
  const [disqualifySaving, setDisqualifySaving] = useState(false)

  const [invalidContact, setInvalidContact] = useState<ContactRow | null>(null)
  const [invalidSaving, setInvalidSaving] = useState(false)

  const [revealed, setRevealed] = useState<Record<string, Partial<Record<'phone' | 'email', string>>>>({})
  const [revealing, setRevealing] = useState<string | null>(null)

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    designation: '',
    source: 'Phone' as (typeof SOURCES)[number],
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search.trim()) params.set('search', search.trim())
      if (assignedFilter !== 'all') params.set('assigned', assignedFilter)
      const res = await api.get<ContactRow[]>(`/contacts?${params}`)
      setContacts(res.data ?? [])
      setTotal(res.pagination?.total ?? res.data?.length ?? 0)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [page, search, assignedFilter])

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  useEffect(() => {
    api
      .get<OrgUser[]>('/users')
      .then((res) =>
        setSalespeople(
          (res.data ?? []).filter((u) => u.status === 'active' && SALES_ROLES.includes(u.role))
        )
      )
      .catch(() => setSalespeople([]))
  }, [])

  const drainQueue = useCallback(async () => {
    const queued = await listQueuedMutations().catch(() => [])
    if (queued.length === 0) return
    let synced = 0
    for (const m of queued) {
      try {
        await api.post(m.path, m.body)
        await removeQueuedMutation(m.id)
        synced++
      } catch (err) {
        if (err instanceof ApiError) {
          // Permanent rejection (stale version, validation) — this item can
          // never succeed. Drop it and keep draining the rest of the queue.
          await removeQueuedMutation(m.id)
          continue
        }
        // Network failure — still offline. Stop; retry on the next
        // 'online' event / page load.
        break
      }
    }
    if (synced > 0) {
      toast(`Synced ${synced} offline update${synced > 1 ? 's' : ''}`)
      await load()
    }
  }, [load, toast])

  useEffect(() => {
    void drainQueue()
    window.addEventListener('online', drainQueue)
    return () => window.removeEventListener('online', drainQueue)
  }, [drainQueue])

  useEffect(() => {
    // Release the call-log lease if the user navigates away with the modal open.
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [])

  function openAssign(contact: ContactRow) {
    setAssigningContact(contact)
    setAssignForm({ companyName: '', assignedToId: '', handoffNotes: '' })
  }

  async function assignToSales(e: React.FormEvent) {
    e.preventDefault()
    if (!assigningContact) return
    setAssignSaving(true)
    try {
      await api.post(`/contacts/${assigningContact.id}/assign-to-sales`, {
        companyName: assignForm.companyName.trim(),
        assignedToId: assignForm.assignedToId,
        handoffNotes: assignForm.handoffNotes.trim(),
      })
      toast('Contact assigned — lead created')
      setAssigningContact(null)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to assign contact', 'error')
    } finally {
      setAssignSaving(false)
    }
  }

  async function openCallLog(contact: ContactRow) {
    try {
      await api.post(`/contacts/${contact.id}/lock`, {})
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not start call log', 'error')
      return
    }
    setCallLogForm({ outcome: CALL_OUTCOMES[0], duration: '', notes: '' })
    setCallLogContact(contact)
    heartbeatRef.current = setInterval(() => {
      void api.post(`/contacts/${contact.id}/lock`, {}).catch(() => {})
    }, 30_000)
  }

  async function closeCallLog(contactId: string) {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    setCallLogContact(null)
    await api.delete(`/contacts/${contactId}/lock`).catch(() => {})
  }

  async function submitCallLog(e: React.FormEvent) {
    e.preventDefault()
    if (!callLogContact) return
    setCallLogSaving(true)
    const contactId = callLogContact.id
    const path = `/contacts/${contactId}/activities`
    const body = {
      type: 'call',
      outcome: callLogForm.outcome,
      duration: callLogForm.duration ? Number(callLogForm.duration) : undefined,
      notes: callLogForm.notes.trim() || undefined,
      expectedVersion: callLogContact.version,
      clientMutationId: crypto.randomUUID(),
    }
    try {
      try {
        await api.post(path, body)
        toast('Call logged')
      } catch (err) {
        if (err instanceof ApiError) throw err
        // Not an API rejection — a network failure. Queue it; the drain
        // effect (online event / next load) submits it with the same
        // clientMutationId, which the server dedupes against (task #18).
        await queueMutation({ id: body.clientMutationId, path, body, createdAt: Date.now() })
        toast('Offline — call saved, will sync automatically')
      }
      setCallLogContact(null)
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current)
        heartbeatRef.current = null
      }
      await api.delete(`/contacts/${contactId}/lock`).catch(() => {})
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to log call', 'error')
    } finally {
      setCallLogSaving(false)
    }
  }

  function openReminder(contact: ContactRow) {
    setReminderForm({ dueDate: '', dueTime: '', note: '' })
    setReminderContact(contact)
  }

  async function submitReminder(e: React.FormEvent) {
    e.preventDefault()
    if (!reminderContact) return
    setReminderSaving(true)
    const path = `/contacts/${reminderContact.id}/activities`
    const dueDate = new Date(`${reminderForm.dueDate}T${reminderForm.dueTime || '09:00'}`)
    const body = {
      type: 'reminder',
      dueDate: dueDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      note: reminderForm.note.trim() || undefined,
      expectedVersion: reminderContact.version,
      clientMutationId: crypto.randomUUID(),
    }
    try {
      try {
        await api.post(path, body)
        toast('Reminder set')
      } catch (err) {
        if (err instanceof ApiError) throw err
        await queueMutation({ id: body.clientMutationId, path, body, createdAt: Date.now() })
        toast('Offline — reminder saved, will sync automatically')
      }
      setReminderContact(null)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to set reminder', 'error')
    } finally {
      setReminderSaving(false)
    }
  }

  function openDisqualify(contact: ContactRow) {
    setDisqualifyForm({ reason: DISQUALIFIED_REASONS[0], details: '' })
    setDisqualifyContact(contact)
  }

  const disqualifyDetailsTooShort =
    disqualifyForm.reason === 'Other' && disqualifyForm.details.trim().length < MIN_OTHER_DETAILS_LENGTH

  async function submitDisqualify(e: React.FormEvent) {
    e.preventDefault()
    if (!disqualifyContact) return
    if (disqualifyDetailsTooShort) {
      toast(`Details must be at least ${MIN_OTHER_DETAILS_LENGTH} characters`, 'error')
      return
    }
    setDisqualifySaving(true)
    try {
      await api.post(`/contacts/${disqualifyContact.id}/disqualify`, {
        reason: disqualifyForm.reason,
        details: disqualifyForm.details.trim() || undefined,
        expectedVersion: disqualifyContact.version,
      })
      toast('Contact disqualified')
      setDisqualifyContact(null)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to disqualify contact', 'error')
    } finally {
      setDisqualifySaving(false)
    }
  }

  async function confirmMarkInvalid() {
    if (!invalidContact) return
    setInvalidSaving(true)
    try {
      await api.delete(`/contacts/${invalidContact.id}`)
      toast('Contact marked invalid')
      setInvalidContact(null)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to mark contact invalid', 'error')
    } finally {
      setInvalidSaving(false)
    }
  }

  async function revealField(contact: ContactRow, field: 'phone' | 'email') {
    setRevealing(`${contact.id}:${field}`)
    try {
      const res = await api.post<{ field: string; value: string }>(`/contacts/${contact.id}/unmask`, { field })
      if (res.data) {
        setRevealed((r) => ({ ...r, [contact.id]: { ...r[contact.id], [field]: res.data!.value } }))
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to reveal value', 'error')
    } finally {
      setRevealing(null)
    }
  }

  async function createContact(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/contacts', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        designation: form.designation.trim() || undefined,
        source: form.source,
      })
      toast('Contact created')
      setShowNew(false)
      setForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        designation: '',
        source: 'Phone',
      })
      setPage(1)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create contact', 'error')
    } finally {
      setSaving(false)
    }
  }

  const activeQueueContacts = contacts.filter(isActiveQueueContact)
  const handedOffContacts = contacts.filter((c) => !isActiveQueueContact(c))
  const wonHandedOffCount = handedOffContacts.filter((c) => c.leads[0]?.stage === 'Order Closed').length
  const conversionRate =
    handedOffContacts.length > 0 ? Math.round((wonHandedOffCount / handedOffContacts.length) * 100) : 0

  useEffect(() => {
    setFocusedIndex(0)
  }, [queueTab, activeQueueContacts.length])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || queueTab !== 'active') return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const anyModalOpen =
        callLogContact || reminderContact || assigningContact || disqualifyContact || invalidContact || showNew
      if (anyModalOpen) return

      const key = e.key.toLowerCase()
      if (key === 'n') {
        e.preventDefault()
        setFocusedIndex((i) => Math.min(i + 1, Math.max(0, activeQueueContacts.length - 1)))
      } else if (key === 'p') {
        e.preventDefault()
        setFocusedIndex((i) => Math.max(i - 1, 0))
      } else if (key === 'c' || key === 'r') {
        const contact = activeQueueContacts[focusedIndex]
        if (!contact) return
        const isLocked = Boolean(
          contact.lockedByUserId && contact.lockedUntil && new Date(contact.lockedUntil) > new Date()
        )
        if (contact.isDncListed || (key === 'c' && isLocked)) return
        e.preventDefault()
        if (key === 'c') void openCallLog(contact)
        else openReminder(contact)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    queueTab,
    activeQueueContacts,
    focusedIndex,
    callLogContact,
    reminderContact,
    assigningContact,
    disqualifyContact,
    invalidContact,
    showNew,
  ])

  return (
    <div className="flex flex-col gap-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label="Contacts" helper="in your workspace" value={total || '—'} />
        <MetricCard
          label="On this page"
          helper="current results"
          value={loading ? '—' : contacts.length}
        />
      </section>

      <section className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {QUEUE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setQueueTab(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              queueTab === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {ASSIGN_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setPage(1)
              setAssignedFilter(tab.key)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              assignedFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 shadow-soft">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => {
              setPage(1)
              setSearch(e.target.value)
            }}
            className={cn(inputClass, 'pl-8')}
          />
        </div>
        <PermissionGate permission="contacts:create">
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New contact
          </Button>
        </PermissionGate>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {queueTab === 'active' && (
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">Name</th>
              <th className="px-3 py-2.5 font-medium">Phone</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">Stage</th>
              <th className="px-3 py-2.5 font-medium">Sales assignment</th>
              <th className="px-3 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && activeQueueContacts.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : activeQueueContacts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No contacts yet. Add database leads here for marketing outreach.
                </td>
              </tr>
            ) : (
              activeQueueContacts.map((c, idx) => {
                const isLocked = Boolean(
                  c.lockedByUserId && c.lockedUntil && new Date(c.lockedUntil) > new Date()
                )
                // A lead in a "lost" terminal stage (incl. one sent back via the
                // Return-to-Lead-Gen manager override) reopens lead-gen actions;
                // anything else linked (open pipeline or won) keeps this read-only.
                const linkedLead = c.leads[0]
                const showActions = !linkedLead || LOST_LEAD_STAGES.includes(linkedLead.stage)
                const revealedPhone = revealed[c.id]?.phone
                const revealedEmail = revealed[c.id]?.email
                return (
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-border/60 last:border-0 hover:bg-muted/30',
                    idx === focusedIndex && 'ring-2 ring-inset ring-primary'
                  )}
                >

                  <td className="px-3 py-2.5 font-medium">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {revealedPhone ?? c.phone}
                      {c.phone === MASK_PLACEHOLDER && !revealedPhone && (
                        <button
                          type="button"
                          title="Reveal phone"
                          disabled={revealing === `${c.id}:phone`}
                          onClick={() => revealField(c, 'phone')}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-60"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {c.phone !== MASK_PLACEHOLDER && !c.isDncListed && (
                        <a
                          href={`tel:${revealedPhone ?? c.phone}`}
                          title="Dial (no CTI provider connected — opens your device's phone app)"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {revealedEmail ?? c.email}
                      {c.email === MASK_PLACEHOLDER && !revealedEmail && (
                        <button
                          type="button"
                          title="Reveal email"
                          disabled={revealing === `${c.id}:email`}
                          onClick={() => revealField(c, 'email')}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-60"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{c.source}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                          STAGE_BADGE[c.stage] ?? 'bg-muted text-muted-foreground'
                        )}
                      >
                        {c.stage}
                      </span>
                      {c.isDncListed && (
                        <span
                          title="Do-Not-Call listed — cannot be contacted without a compliance override"
                          className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                        >
                          DNC
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {linkedLead ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        Assigned to {linkedLead.assignedTo?.fullName ?? 'unassigned rep'} · {linkedLead.stage}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {showActions && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <PermissionGate permission="activities:create">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isLocked || c.isDncListed}
                            title={
                              c.isDncListed
                                ? 'Do-Not-Call listed'
                                : isLocked
                                ? 'Locked by another user'
                                : undefined
                            }
                            onClick={() => openCallLog(c)}
                          >
                            Call log
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={c.isDncListed}
                            title={c.isDncListed ? 'Do-Not-Call listed' : undefined}
                            onClick={() => openReminder(c)}
                          >
                            Reminder
                          </Button>
                        </PermissionGate>
                        <PermissionGate permission="contacts:edit">
                          <Button size="sm" variant="outline" onClick={() => openAssign(c)}>
                            Assign to sales
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openDisqualify(c)}>
                            Disqualify
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setInvalidContact(c)}
                          >
                            Mark invalid
                          </Button>
                        </PermissionGate>
                      </div>
                    )}
                  </td>
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      {queueTab === 'handedOff' && (
        <>
          <section className="grid grid-cols-3 gap-3">
            <MetricCard label="Total handed off" value={handedOffContacts.length} />
            <MetricCard label="Order Closed" value={wonHandedOffCount} />
            <MetricCard label="Conversion rate" value={`${conversionRate}%`} />
          </section>
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-soft">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Phone</th>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="px-3 py-2.5 font-medium">Sales assignment</th>
                </tr>
              </thead>
              <tbody>
                {loading && handedOffContacts.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <div className="h-4 w-full max-w-[120px] animate-pulse rounded bg-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : handedOffContacts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No contacts handed off to sales yet.
                    </td>
                  </tr>
                ) : (
                  handedOffContacts.map((c) => {
                    const linkedLead = c.leads[0]
                    return (
                      <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium">
                          {c.firstName} {c.lastName}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{c.phone}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{c.email}</td>
                        <td className="px-3 py-2.5">{c.source}</td>
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                              STAGE_BADGE[c.stage] ?? 'bg-muted text-muted-foreground'
                            )}
                          >
                            {c.stage}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          {linkedLead ? (
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                              {linkedLead.assignedTo?.fullName ?? 'unassigned rep'} · {linkedLead.stage}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {total > 50 && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={page * 50 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {showNew && (
        <Modal title="New contact" onClose={() => setShowNew(false)}>
          <form onSubmit={createContact} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                First name
                <input
                  required
                  className={inputClass}
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Last name
                <input
                  required
                  className={inputClass}
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Phone
                <input
                  required
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  required
                  type="email"
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Designation
                <input
                  className={inputClass}
                  value={form.designation}
                  onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Source
                <select
                  className={inputClass}
                  value={form.source}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, source: e.target.value as (typeof SOURCES)[number] }))
                  }
                >
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className={cn(saving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Create contact
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {assigningContact && (
        <Modal
          title={`Assign ${assigningContact.firstName} ${assigningContact.lastName} to sales`}
          onClose={() => setAssigningContact(null)}
        >
          <form onSubmit={assignToSales} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Company name
              <input
                required
                className={inputClass}
                value={assignForm.companyName}
                onChange={(e) => setAssignForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Salesperson
              <select
                required
                className={inputClass}
                value={assignForm.assignedToId}
                onChange={(e) => setAssignForm((f) => ({ ...f, assignedToId: e.target.value }))}
              >
                <option value="" disabled>
                  Select salesperson
                </option>
                {salespeople.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Handoff notes
              <textarea
                required
                minLength={10}
                rows={3}
                className={cn(inputClass, 'h-auto py-2')}
                placeholder="Requirement, urgency, customer expectations…"
                value={assignForm.handoffNotes}
                onChange={(e) => setAssignForm((f) => ({ ...f, handoffNotes: e.target.value }))}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Creates a new lead assigned to this salesperson, with source set to your name. This
              contact stays here, marked as assigned. Requires at least one Connected call already
              logged.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAssigningContact(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  assignSaving ||
                  !assignForm.companyName.trim() ||
                  !assignForm.assignedToId ||
                  assignForm.handoffNotes.trim().length < 10
                }
                className={cn(assignSaving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Assign
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {callLogContact && (
        <Modal
          title={`Log a call — ${callLogContact.firstName} ${callLogContact.lastName}`}
          onClose={() => void closeCallLog(callLogContact.id)}
        >
          <form onSubmit={submitCallLog} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Call outcome
              <select
                required
                className={inputClass}
                value={callLogForm.outcome}
                onChange={(e) =>
                  setCallLogForm((f) => ({
                    ...f,
                    outcome: e.target.value as (typeof CALL_OUTCOMES)[number],
                  }))
                }
              >
                {CALL_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Duration (minutes)
              <input
                type="number"
                min={0}
                className={inputClass}
                value={callLogForm.duration}
                onChange={(e) => setCallLogForm((f) => ({ ...f, duration: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Notes
              <textarea
                rows={3}
                className={cn(inputClass, 'h-auto py-2')}
                placeholder="Requirement details, next steps…"
                value={callLogForm.notes}
                onChange={(e) => setCallLogForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void closeCallLog(callLogContact.id)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={callLogSaving}
                className={cn(callLogSaving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {reminderContact && (
        <Modal
          title={`Set reminder — ${reminderContact.firstName} ${reminderContact.lastName}`}
          onClose={() => setReminderContact(null)}
        >
          <form onSubmit={submitReminder} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Follow-up date
                <input
                  required
                  type="date"
                  className={inputClass}
                  value={reminderForm.dueDate}
                  onChange={(e) => setReminderForm((f) => ({ ...f, dueDate: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Time
                <input
                  type="time"
                  className={inputClass}
                  value={reminderForm.dueTime}
                  onChange={(e) => setReminderForm((f) => ({ ...f, dueTime: e.target.value }))}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Note
              <textarea
                rows={3}
                className={cn(inputClass, 'h-auto py-2')}
                placeholder="Waiting on specs, call back after lunch…"
                value={reminderForm.note}
                onChange={(e) => setReminderForm((f) => ({ ...f, note: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setReminderContact(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={reminderSaving}
                className={cn(reminderSaving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {disqualifyContact && (
        <Modal
          title={`Disqualify ${disqualifyContact.firstName} ${disqualifyContact.lastName}`}
          onClose={() => setDisqualifyContact(null)}
        >
          <form onSubmit={submitDisqualify} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Reason
              <select
                required
                className={inputClass}
                value={disqualifyForm.reason}
                onChange={(e) => setDisqualifyForm((f) => ({ ...f, reason: e.target.value }))}
              >
                {DISQUALIFIED_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Details{disqualifyForm.reason === 'Other' && ` (required, min ${MIN_OTHER_DETAILS_LENGTH} characters)`}
              <textarea
                required={disqualifyForm.reason === 'Other'}
                rows={3}
                className={cn(inputClass, 'h-auto py-2')}
                value={disqualifyForm.details}
                onChange={(e) => setDisqualifyForm((f) => ({ ...f, details: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDisqualifyContact(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={disqualifySaving || disqualifyDetailsTooShort}
                className={cn(disqualifySaving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Disqualify
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {invalidContact && (
        <Modal
          title={`Mark ${invalidContact.firstName} ${invalidContact.lastName} invalid`}
          onClose={() => setInvalidContact(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              For entries that shouldn&apos;t exist at all (wrong number, garbage entry) rather than a
              genuine closed inquiry. The contact is hidden, not deleted — its phone/email become free
              to reuse for a legitimate new inquiry.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setInvalidContact(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={invalidSaving}
                className={cn(
                  'text-destructive hover:text-destructive',
                  invalidSaving && 'opacity-60 disabled:cursor-not-allowed'
                )}
                onClick={confirmMarkInvalid}
              >
                Mark invalid
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
