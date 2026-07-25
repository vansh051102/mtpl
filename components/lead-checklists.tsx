'use client'

import { useState } from 'react'
import { api } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

interface ChecklistItem {
  id: string
  title: string
  completed: boolean
}

interface Checklist {
  id: string
  title: string
  isRequired: boolean
  items: ChecklistItem[]
}

export function LeadChecklists({
  leadId,
  checklists,
  onChanged,
  renderActions,
}: {
  leadId: string
  checklists: Checklist[]
  onChanged: () => void
  renderActions?: (onShow: () => void) => React.ReactNode
}) {
  const { toast } = useToast()
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create-checklist form state
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [isRequired, setIsRequired] = useState(true)
  const [itemsText, setItemsText] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  async function toggleItem(checklistId: string, item: ChecklistItem) {
    setPendingItemId(item.id)
    setError(null)
    try {
      await api.put(`/checklists/${checklistId}/items/${item.id}`, { completed: !item.completed })
      onChanged()
    } catch (err) {
      setError(toFormErrors(err, 'Failed to update checklist item').message)
    } finally {
      setPendingItemId(null)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    const items = itemsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((t) => ({ title: t }))

    if (items.length === 0) {
      setFieldErrors({ items: 'Add at least one item (one per line)' })
      return
    }

    setSubmitting(true)
    try {
      await api.post(`/leads/${leadId}/checklists`, { title, isRequired, items })
      setShowForm(false)
      setTitle('')
      setIsRequired(true)
      setItemsText('')
      toast('Checklist created')
      onChanged()
    } catch (err) {
      const parsed = toFormErrors(err, 'Failed to create checklist')
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {checklists.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No checklists yet.</p>
      )}
      {checklists.map((checklist) => {
        const done = checklist.items.filter((i) => i.completed).length
        const total = checklist.items.length
        const percent = total === 0 ? 0 : Math.round((done / total) * 100)

        return (
          <Card key={checklist.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-foreground">
                <span>
                  {checklist.title}{' '}
                  {checklist.isRequired && (
                    <span className="text-destructive" title="Required — blocks stage progression">
                      *
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {done}/{total} ({percent}%)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {checklist.items.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={pendingItemId === item.id}
                    onChange={() => toggleItem(checklist.id, item)}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className={item.completed ? 'text-muted-foreground line-through' : ''}>
                    {item.title}
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {showForm ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="checklist-title" className="text-sm font-medium">
                Title
              </label>
              <input
                id="checklist-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              {fieldErrors.title && <p className="text-xs text-destructive">{fieldErrors.title}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="checklist-items" className="text-sm font-medium">
                Items (one per line)
              </label>
              <textarea
                id="checklist-items"
                value={itemsText}
                onChange={(e) => setItemsText(e.target.value)}
                rows={4}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              {fieldErrors.items && <p className="text-xs text-destructive">{fieldErrors.items}</p>}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Required — blocks stage progression until complete
            </label>

            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={submitting || !title.trim()}
                className="flex items-center justify-center gap-2 transition-opacity duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Create checklist
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
            New checklist
          </Button>
        )
      )}
    </div>
  )
}
