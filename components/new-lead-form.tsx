'use client'

import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { Button } from '@/components/ui/button'
import { LEAD_PRIORITIES, CLOSING_HORIZONS, CUSTOMER_SEGMENTS, PRODUCT_CATEGORIES } from '@/lib/validation'
import { useCurrentUser } from '@/lib/use-current-user'

interface ContactOption {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
}

interface DuplicateContactDetails {
  reason: 'phone' | 'email' | 'gst' | 'open_lead'
  existingContact: { id: string; firstName: string; lastName: string }
  existingLead: { id: string; companyName: string; stage: string; assignedTo: { fullName: string } | null } | null
  actions: Array<'view' | 'logAsRepeat' | 'reassign'>
}

const CLOSING_HORIZON_LABELS: Record<(typeof CLOSING_HORIZONS)[number], string> = {
  next_2_days: 'Next 2 days',
  next_3_days: 'Next 3 days',
  '1_week': '1 week',
  '1_month': '1 month',
  custom: 'Custom date',
}

export function NewLeadForm({ onCreated }: { onCreated: (leadId: string) => void }) {
  const currentUser = useCurrentUser()
  const [mode, setMode] = useState<'existing' | 'new'>('new')

  // Existing-contact search
  const [contactSearch, setContactSearch] = useState('')
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([])
  const [selectedContactId, setSelectedContactId] = useState('')

  // New-contact fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [gstNumber, setGstNumber] = useState('')

  // Lead fields
  const [companyName, setCompanyName] = useState('')
  const [priority, setPriority] = useState<(typeof LEAD_PRIORITIES)[number]>('Medium')
  const [notes, setNotes] = useState('')
  const [closingHorizon, setClosingHorizon] = useState<(typeof CLOSING_HORIZONS)[number] | ''>('')
  const [targetClosingDate, setTargetClosingDate] = useState('')
  const [territory, setTerritory] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [customerSegment, setCustomerSegment] = useState<(typeof CUSTOMER_SEGMENTS)[number] | ''>('')
  const [productCategory, setProductCategory] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // Duplicate contact detection: runs when phone or email changes in new-contact mode
  const [dupMatches, setDupMatches] = useState<ContactOption[]>([])
  const [ignoreDup, setIgnoreDup] = useState(false)

  // Server-side duplicate conflict (409 DUPLICATE_CONTACT) — surfaced with
  // existing lead detail + view/log-as-repeat/reassign actions, instead of a
  // raw error, per the diagnostic-banner spec.
  const [conflict, setConflict] = useState<DuplicateContactDetails | null>(null)
  const [reassigning, setReassigning] = useState(false)

  useEffect(() => {
    if (mode !== 'existing' || contactSearch.trim().length < 2) {
      setContactOptions([])
      return
    }
    let cancelled = false
    const debounce = setTimeout(async () => {
      try {
        const res = await api.get<ContactOption[]>(`/contacts?search=${encodeURIComponent(contactSearch)}&limit=10`)
        if (!cancelled) setContactOptions(res.data ?? [])
      } catch {
        if (!cancelled) setContactOptions([])
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(debounce)
    }
  }, [mode, contactSearch])

  useEffect(() => {
    if (mode !== 'new') { setDupMatches([]); return }
    const p = phone.trim()
    const em = email.trim()
    if (!p && !em) { setDupMatches([]); return }
    let cancelled = false
    const debounce = setTimeout(async () => {
      try {
        const qs = new URLSearchParams()
        if (p) qs.set('phone', p)
        if (em) qs.set('email', em)
        const res = await api.get<ContactOption[]>(`/contacts?${qs.toString()}`)
        if (!cancelled) setDupMatches(res.data ?? [])
      } catch {
        if (!cancelled) setDupMatches([])
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(debounce) }
  }, [mode, phone, email])

  async function createLead(contactId: string, opts: { repeatOfLeadId?: string } = {}) {
    setSubmitting(true)
    try {
      const leadRes = await api.post<{ id: string }>('/leads', {
        contactId,
        companyName,
        priority,
        notes: notes || undefined,
        closingHorizon: closingHorizon || undefined,
        targetClosingDate: closingHorizon && targetClosingDate ? targetClosingDate : undefined,
        territory: territory || undefined,
        serviceArea: serviceArea || undefined,
        pinCode: pinCode || undefined,
        customerSegment: customerSegment || undefined,
        productCategory: productCategory || undefined,
        ...(opts.repeatOfLeadId && { sourceDetails: { repeatOf: opts.repeatOfLeadId } }),
      })
      onCreated(leadRes.data!.id)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_CONTACT') {
        setConflict(err.details as DuplicateContactDetails)
        return
      }
      const parsed = toFormErrors(err, 'Failed to create lead')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setConflict(null)

    if (!companyName.trim()) {
      setError('Company name is required')
      return
    }
    if (mode === 'existing' && !selectedContactId) {
      setError('Select a contact')
      return
    }
    if (mode === 'new' && (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim())) {
      setError('First name, last name, email, and phone are required for a new contact')
      return
    }

    if (mode === 'existing') {
      await createLead(selectedContactId)
      return
    }

    setSubmitting(true)
    try {
      const contactRes = await api.post<{ id: string }>('/contacts', {
        firstName,
        lastName,
        email,
        phone,
        gstNumber: gstNumber || undefined,
      })
      setSubmitting(false)
      await createLead(contactRes.data!.id)
    } catch (err) {
      setSubmitting(false)
      if (err instanceof ApiError && err.code === 'DUPLICATE_CONTACT') {
        setConflict(err.details as DuplicateContactDetails)
        return
      }
      const parsed = toFormErrors(err, 'Failed to create lead')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    }
  }

  // Contact already exists (that's why we're here) — skip POST /contacts
  // entirely and create the lead against the existing contact directly, or
  // it would just hit the same 409 again. See lib/contact-duplicate-check.ts.
  async function handleLogAsRepeat() {
    if (!conflict?.existingLead || !conflict.existingContact.id) return
    const existingLeadId = conflict.existingLead.id
    setConflict(null)
    await createLead(conflict.existingContact.id, { repeatOfLeadId: existingLeadId })
  }

  async function handleReassignToMe() {
    if (!conflict?.existingLead || !currentUser) return
    setReassigning(true)
    try {
      await api.put(`/leads/${conflict.existingLead.id}/assign`, { assignedToId: currentUser.id })
      onCreated(conflict.existingLead.id)
    } catch (err) {
      const parsed = toFormErrors(err, 'Failed to reassign lead')
      setError(parsed.message)
    } finally {
      setReassigning(false)
      setConflict(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'new' ? 'default' : 'outline'}
          onClick={() => setMode('new')}
        >
          New Contact
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'existing' ? 'default' : 'outline'}
          onClick={() => setMode('existing')}
        >
          Existing Contact
        </Button>
      </div>

      {conflict && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">
            {conflict.existingLead
              ? `Already exists: ${conflict.existingLead.companyName} (${conflict.existingLead.stage})`
              : 'Contact already exists'}
          </p>
          {conflict.existingLead?.assignedTo && (
            <p className="mt-1 text-muted-foreground">
              Assigned to {conflict.existingLead.assignedTo.fullName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {conflict.actions.includes('view') && conflict.existingLead && (
              <a
                href={`/leads/${conflict.existingLead.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                View existing lead
              </a>
            )}
            {conflict.actions.includes('logAsRepeat') && conflict.existingLead && (
              <button
                type="button"
                onClick={handleLogAsRepeat}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Log as repeat enquiry
              </button>
            )}
            {conflict.actions.includes('reassign') && conflict.existingLead && (
              <button
                type="button"
                disabled={reassigning}
                onClick={handleReassignToMe}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                {reassigning ? 'Reassigning…' : 'Reassign to me'}
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'existing' ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Search contact</label>
          <input
            value={contactSearch}
            onChange={(e) => {
              setContactSearch(e.target.value)
              setSelectedContactId('')
            }}
            placeholder="Name, email, or phone…"
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {contactOptions.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              {contactOptions.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => {
                    setSelectedContactId(c.id)
                    setContactSearch(`${c.firstName} ${c.lastName}`)
                    setContactOptions([])
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {c.firstName} {c.lastName} · {c.email}
                </button>
              ))}
            </div>
          )}
          {selectedContactId && <p className="text-xs text-muted-foreground">Contact selected.</p>}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-first-name" className="text-sm font-medium">
              First name
            </label>
            <input
              id="lead-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.firstName && <p className="text-xs text-destructive">{fieldErrors.firstName}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-last-name" className="text-sm font-medium">
              Last name
            </label>
            <input
              id="lead-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.lastName && <p className="text-xs text-destructive">{fieldErrors.lastName}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.email && <p className="text-xs text-destructive">{fieldErrors.email}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-phone" className="text-sm font-medium">
              Phone
            </label>
            <input
              id="lead-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {fieldErrors.phone && <p className="text-xs text-destructive">{fieldErrors.phone}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lead-gst" className="text-sm font-medium">
              GST Number (optional)
            </label>
            <input
              id="lead-gst"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {!ignoreDup && dupMatches.length > 0 && (
          <div className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              Possible duplicate{dupMatches.length > 1 ? 's' : ''} found
            </p>
            <ul className="mt-1 space-y-1">
              {dupMatches.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-amber-700 dark:text-amber-400">
                    {c.firstName} {c.lastName} · {c.phone || c.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedContactId(c.id)
                      setMode('existing')
                      setContactSearch(`${c.firstName} ${c.lastName}`)
                      setDupMatches([])
                    }}
                    className="whitespace-nowrap text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Use this contact
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setIgnoreDup(true)}
              className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Ignore and create anyway
            </button>
          </div>
        )}
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-company" className="text-sm font-medium">
          Company name
        </label>
        <input
          id="lead-company"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {fieldErrors.companyName && <p className="text-xs text-destructive">{fieldErrors.companyName}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Priority</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as (typeof LEAD_PRIORITIES)[number])}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        >
          {LEAD_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Target closing horizon (optional)</label>
        <select
          value={closingHorizon}
          onChange={(e) => setClosingHorizon(e.target.value as (typeof CLOSING_HORIZONS)[number] | '')}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Not set</option>
          {CLOSING_HORIZONS.map((h) => (
            <option key={h} value={h}>
              {CLOSING_HORIZON_LABELS[h]}
            </option>
          ))}
        </select>
        {closingHorizon === 'custom' && (
          <input
            type="date"
            value={targetClosingDate}
            onChange={(e) => setTargetClosingDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-territory" className="text-sm font-medium">
            Territory (optional)
          </label>
          <input
            id="lead-territory"
            value={territory}
            onChange={(e) => setTerritory(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-service-area" className="text-sm font-medium">
            Service area (optional)
          </label>
          <input
            id="lead-service-area"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-pincode" className="text-sm font-medium">
            Pin code (optional)
          </label>
          <input
            id="lead-pincode"
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-customer-segment" className="text-sm font-medium">
            Customer segment (optional)
          </label>
          <select
            id="lead-customer-segment"
            value={customerSegment}
            onChange={(e) => setCustomerSegment(e.target.value as (typeof CUSTOMER_SEGMENTS)[number] | '')}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Not set</option>
            {CUSTOMER_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lead-product-category" className="text-sm font-medium">
            Product category (optional)
          </label>
          <select
            id="lead-product-category"
            value={productCategory}
            onChange={(e) => setProductCategory(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Not set</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={submitting}
        className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Create lead
      </Button>
    </form>
  )
}
