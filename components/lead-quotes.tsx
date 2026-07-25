'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { useAuth, useHasPermission } from '@/lib/use-current-user'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QuotePdfDialog } from '@/components/quote-pdf-dialog'
import { useToast } from '@/components/ui/toast'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Quote {
  id: string
  quoteNumber: string
  status: string
  finalAmount: string
  validUntil: string
}

interface FullQuote extends Quote {
  items?: { productId: string; quantity: number; price: number; discount: number }[]
  notes?: string | null
  terms?: string | null
}

interface LineItem {
  key: string
  description: string
  quantity: string
  rate: string
  discount: string
}

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'destructive'> = {
  draft: 'default',
  sent: 'warning',
  accepted: 'success',
  rejected: 'destructive',
  expired: 'destructive',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
}

const fieldClass =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary'

function defaultValidUntil(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

function emptyLineItem(): LineItem {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    description: '',
    quantity: '1',
    rate: '',
    discount: '0',
  }
}

function lineAmount(item: LineItem): number {
  const qty = Number(item.quantity) || 0
  const rate = Number(item.rate) || 0
  const discount = Number(item.discount) || 0
  return Math.max(0, qty * rate - discount)
}

function validateAndCleanItems(
  items: LineItem[],
  validUntil: string
): { cleaned: { description: string; quantity: number; rate: number; discount: number }[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (!validUntil) {
    errors.validUntil = 'Please pick till when this quote is valid'
  }

  const cleaned = items
    .map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      rate: Number(item.rate),
      discount: Number(item.discount) || 0,
    }))
    .filter((item) => item.description || item.rate)

  if (cleaned.length === 0) {
    errors.items = 'Add at least one item with name and rate'
  } else {
    for (const [i, item] of cleaned.entries()) {
      if (!item.description) {
        errors.items = `Row ${i + 1}: write the item name (e.g. ERW pipe 40NB)`
        break
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        errors.items = `Row ${i + 1}: quantity must be more than 0`
        break
      }
      if (!Number.isFinite(item.rate) || item.rate <= 0) {
        errors.items = `Row ${i + 1}: enter rate in ₹`
        break
      }
      if (item.discount < 0) {
        errors.items = `Row ${i + 1}: discount cannot be negative`
        break
      }
    }
  }

  return { cleaned, errors }
}

function toApiItems(cleaned: { description: string; quantity: number; rate: number; discount: number }[]) {
  return cleaned.map((i) => ({
    productId: i.description,
    quantity: i.quantity,
    price: i.rate,
    discount: i.discount,
  }))
}

export function LeadQuotes({
  leadId,
  quotes,
  onChanged,
  renderActions,
  autoOpenForm = false,
}: {
  leadId: string
  quotes: Quote[]
  onChanged: () => void
  renderActions?: (onShow: () => void) => React.ReactNode
  /** Open the create form immediately (Create Quote quick-action). */
  autoOpenForm?: boolean
}) {
  const { toast } = useToast()
  const { isLoading: authLoading } = useAuth()
  const canCreate = useHasPermission('quotes:create')
  const canEdit = useHasPermission('quotes:edit')
  const canSend = useHasPermission('quotes:send')
  const canRead = useHasPermission('quotes:read')
  const [showForm, setShowForm] = useState(autoOpenForm && quotes.length === 0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null)
  const [openingPdf, setOpeningPdf] = useState<string | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{ quoteNumber: string; url: string } | null>(null)
  const [items, setItems] = useState<LineItem[]>([emptyLineItem()])
  const [validUntil, setValidUntil] = useState(defaultValidUntil)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const [sendFormId, setSendFormId] = useState<string | null>(null)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [sending, setSending] = useState(false)

  const grandTotal = useMemo(
    () => items.reduce((sum, item) => sum + lineAmount(item), 0),
    [items]
  )

  useEffect(() => {
    if (quotes.length > 0) setShowForm(false)
  }, [quotes.length])

  useEffect(() => {
    if (autoOpenForm && quotes.length === 0 && canCreate) setShowForm(true)
  }, [autoOpenForm, quotes.length, canCreate])

  useEffect(() => {
    return () => {
      if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    }
  }, [pdfPreview?.url])

  function closePdfPreview() {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url)
    setPdfPreview(null)
  }

  function updateItem(key: string, field: keyof LineItem, value: string) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, [field]: value } : item)))
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.key !== key)))
  }

  function resetForm() {
    setItems([emptyLineItem()])
    setValidUntil(defaultValidUntil())
    setNotes('')
    setFieldErrors({})
    setError(null)
  }

  function openForm() {
    setEditingId(null)
    setShowForm(true)
    resetForm()
  }

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setError(null)
    setFieldErrors({})
  }

  async function startEdit(quoteId: string) {
    setLoadingEdit(quoteId)
    setError(null)
    try {
      const res = await api.get<FullQuote>(`/quotes/${quoteId}`)
      const q = res.data
      if (!q) return

      const rows =
        q.items && q.items.length > 0
          ? q.items.map((item) => ({
              key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              description: item.productId,
              quantity: String(item.quantity),
              rate: String(item.price),
              discount: String(item.discount ?? 0),
            }))
          : [emptyLineItem()]

      setEditingId(quoteId)
      setShowForm(false)
      setItems(rows)
      setValidUntil(new Date(q.validUntil).toISOString().slice(0, 10))
      setNotes(q.notes ?? '')
      setFieldErrors({})
    } catch (err) {
      setError(toFormErrors(err, 'Could not load quote for editing').message)
    } finally {
      setLoadingEdit(null)
    }
  }

  async function openPdf(quoteId: string, quoteNumber: string) {
    setOpeningPdf(quoteId)
    setError(null)
    try {
      const blob = await api.fetchBlob(`/quotes/${quoteId}/pdf`)
      const url = URL.createObjectURL(blob)
      closePdfPreview()
      setPdfPreview({ quoteNumber, url })
    } catch (err) {
      setError(toFormErrors(err, 'Could not open PDF').message)
    } finally {
      setOpeningPdf(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const { cleaned, errors: nextErrors } = validateAndCleanItems(items, validUntil)

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setError(nextErrors.items || nextErrors.validUntil || 'Please check the form')
      return
    }

    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      const [y, m, d] = validUntil.split('-').map(Number)
      const localEnd = new Date(y, m - 1, d, 23, 59, 59)
      await api.post(`/leads/${leadId}/quotes`, {
        items: toApiItems(cleaned),
        validUntil: localEnd.toISOString(),
        notes: notes.trim() || undefined,
      })
      cancelForm()
      toast('Quote created')
      onChanged()
    } catch (err) {
      const parsed = toFormErrors(err, 'Could not create quote — please try again')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editingId) return

    const { cleaned, errors: nextErrors } = validateAndCleanItems(items, validUntil)

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setError(nextErrors.items || nextErrors.validUntil || 'Please check the form')
      return
    }

    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      const [y, m, d] = validUntil.split('-').map(Number)
      const localEnd = new Date(y, m - 1, d, 23, 59, 59)
      await api.put(`/quotes/${editingId}`, {
        items: toApiItems(cleaned),
        validUntil: localEnd.toISOString(),
        notes: notes.trim() || undefined,
      })
      setEditingId(null)
      resetForm()
      toast('Quote updated')
      onChanged()
    } catch (err) {
      const parsed = toFormErrors(err, 'Could not update quote — please try again')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSend(e: React.FormEvent, quoteId: string) {
    e.preventDefault()
    if (!recipientEmail) return
    setSending(true)
    setError(null)
    try {
      await api.post(`/quotes/${quoteId}/send`, { recipientEmail })
      setSendFormId(null)
      setRecipientEmail('')
      toast(`Quote sent to ${recipientEmail}`)
      onChanged()
    } catch (err) {
      setError(toFormErrors(err, 'Could not send quote').message)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {authLoading && quotes.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!authLoading && quotes.length === 0 && !showForm && !editingId && (
          <p className="text-sm text-muted-foreground">
            No quote yet.
            {canCreate
              ? ' Add items with quantity and rate in ₹.'
              : ' Ask purchase or your manager to create a quote.'}
          </p>
        )}

        {!authLoading && quotes.length === 0 && showForm && !canCreate && (
          <p className="text-sm text-muted-foreground">
            You don&apos;t have permission to create quotes. Ask purchase or your manager.
          </p>
        )}

        {quotes.map((q) => (
          <div key={q.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{q.quoteNumber}</p>
                <p className="text-muted-foreground">
                  {formatCurrency(Number(q.finalAmount))} · valid till{' '}
                  {formatDate(new Date(q.validUntil))}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge variant={STATUS_VARIANT[q.status] || 'default'}>
                  {STATUS_LABEL[q.status] || q.status}
                </Badge>
                {canRead && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={openingPdf === q.id}
                    onClick={() => void openPdf(q.id, q.quoteNumber)}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" />
                    {openingPdf === q.id ? 'Loading…' : 'View PDF'}
                  </Button>
                )}
                {q.status === 'draft' && canEdit && editingId !== q.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loadingEdit === q.id}
                    onClick={() => void startEdit(q.id)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    {loadingEdit === q.id ? 'Loading…' : 'Edit'}
                  </Button>
                )}
                {q.status === 'draft' && sendFormId !== q.id && canSend && (
                  <Button size="sm" variant="outline" onClick={() => setSendFormId(q.id)}>
                    Send
                  </Button>
                )}
              </div>
            </div>

            {sendFormId === q.id && (
              <form onSubmit={(e) => handleSend(e, q.id)} className="mt-2 flex flex-wrap gap-2">
                <label htmlFor={`send-email-${q.id}`} className="sr-only">
                  Customer email
                </label>
                <input
                  id={`send-email-${q.id}`}
                  type="email"
                  required
                  autoFocus
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="customer@company.com"
                  className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                />
                <Button type="submit" size="sm" disabled={sending || !recipientEmail}>
                  {sending ? 'Sending…' : 'Send quote'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSendFormId(null)
                    setRecipientEmail('')
                  }}
                >
                  Cancel
                </Button>
              </form>
            )}
          </div>
        ))}

        {canCreate &&
          showForm &&
          !editingId &&
          renderQuoteForm({
            title: 'New quotation',
            submitLabel: 'Create quote',
            onSubmit: handleCreate,
            onCancel: cancelForm,
          })}

        {editingId &&
          canEdit &&
          renderQuoteForm({
            title: 'Edit quotation',
            submitLabel: 'Save changes',
            onSubmit: handleUpdate,
            onCancel: cancelForm,
          })}

        {canCreate && !showForm && !editingId &&
          (renderActions ? (
            renderActions(openForm)
          ) : (
            <Button size="sm" variant="outline" onClick={openForm}>
              New quote
            </Button>
          ))}
      </div>

      {pdfPreview && (
        <QuotePdfDialog
          quoteNumber={pdfPreview.quoteNumber}
          url={pdfPreview.url}
          onClose={closePdfPreview}
        />
      )}
    </>
  )

  function renderQuoteForm({
    title,
    submitLabel,
    onSubmit,
    onCancel,
  }: {
    title: string
    submitLabel: string
    onSubmit: (e: React.FormEvent) => void
    onCancel: () => void
  }) {
    return (
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-md border border-border bg-muted/20 p-3"
      >
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Write each item clearly — size, grade, length. Rates are in ₹.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {items.map((item, index) => {
            const amount = lineAmount(item)
            return (
              <div
                key={item.key}
                className="rounded-md border border-border bg-card p-3 shadow-soft"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Item {index + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    disabled={items.length <= 1}
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Remove item ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium" htmlFor={`desc-${item.key}`}>
                      Item / size / SKU
                    </label>
                    <input
                      id={`desc-${item.key}`}
                      value={item.description}
                      onChange={(e) => updateItem(item.key, 'description', e.target.value)}
                      placeholder="e.g. ERW pipe 40NB × 3.2mm"
                      className={fieldClass}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium" htmlFor={`qty-${item.key}`}>
                        Quantity
                      </label>
                      <input
                        id={`qty-${item.key}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.key, 'quantity', e.target.value)}
                        placeholder="e.g. 100"
                        className={fieldClass}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium" htmlFor={`rate-${item.key}`}>
                        Rate (₹)
                      </label>
                      <input
                        id={`rate-${item.key}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={item.rate}
                        onChange={(e) => updateItem(item.key, 'rate', e.target.value)}
                        placeholder="e.g. 850"
                        className={fieldClass}
                      />
                    </div>
                    <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                      <label className="text-xs font-medium" htmlFor={`disc-${item.key}`}>
                        Discount (₹)
                      </label>
                      <input
                        id={`disc-${item.key}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={item.discount}
                        onChange={(e) => updateItem(item.key, 'discount', e.target.value)}
                        placeholder="0"
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <p className="text-right text-sm font-medium">
                    Line total:{' '}
                    <span className="text-primary">{formatCurrency(amount)}</span>
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {fieldErrors.items && <p className="text-xs text-destructive">{fieldErrors.items}</p>}

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setItems((prev) => [...prev, emptyLineItem()])}
          className="self-start"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add another item
        </Button>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quote-valid-until" className="text-sm font-medium">
              Valid till
            </label>
            <input
              id="quote-valid-until"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className={fieldClass}
            />
            {fieldErrors.validUntil && (
              <p className="text-xs text-destructive">{fieldErrors.validUntil}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="quote-notes" className="text-sm font-medium">
              Notes (optional)
            </label>
            <input
              id="quote-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Delivery, GST, transport…"
              className={fieldClass}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">Quote total</span>
          <span className="text-base font-semibold text-primary">
            {formatCurrency(grandTotal)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={submitting}
            className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }
}
