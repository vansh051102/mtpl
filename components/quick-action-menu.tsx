'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import { api } from '@/lib/api-client'
import { useToast } from '@/components/ui/toast'

// Quotation approval, SLA override, and PR creation all act on a specific
// existing Lead — there's no generic "quick create" for those without picking
// one first, so those three route to the real filtered list rather than fake
// a lead-picker modal here. Only "Log Executive Note" is a true standalone
// action (writes a Task, no lead context needed) and gets an inline form.
const ROUTE_ACTIONS = [
  { label: 'Issue Quotation Approval', href: '/leads?stage=Quote+Sent' },
  { label: 'Override SLA / Assign Lead', href: '/leads?slaBreached=true' },
  { label: 'Create High-Priority Purchase Request', href: '/purchase?status=pending' },
]

export function QuickActionMenu() {
  const [open, setOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submitNote() {
    if (!noteText.trim()) return
    setSubmitting(true)
    try {
      await api.post('/tasks', {
        title: noteText,
        type: 'REMINDER',
        dueAt: new Date().toISOString(),
      })
      toast('Note logged', 'success')
      setNoteText('')
      setNoteOpen(false)
      setOpen(false)
    } catch {
      toast('Could not log note', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {open && (
        <div className="mb-2 w-64 rounded-3xl border border-border bg-white/90 p-2 shadow-apple-float backdrop-blur-md dark:bg-black/70">
          {ROUTE_ACTIONS.map((a) => (
            <button
              key={a.href}
              type="button"
              onClick={() => {
                setOpen(false)
                router.push(a.href)
              }}
              className="flex w-full rounded-xl px-3 py-2.5 text-left text-sm text-foreground hover:bg-muted"
            >
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNoteOpen(true)}
            className="flex w-full rounded-xl px-3 py-2.5 text-left text-sm text-foreground hover:bg-muted"
          >
            Log Direct Executive Note
          </button>
        </div>
      )}

      {noteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={() => setNoteOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-[28px] border border-border bg-card p-4 shadow-apple-float"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 font-display text-base text-foreground">Executive Note</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-border bg-background p-2 text-sm text-foreground"
              placeholder="Type a note…"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteOpen(false)} className="rounded-xl px-3 py-1.5 text-sm text-muted-foreground">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitNote}
                disabled={submitting}
                className="rounded-xl bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Quick actions"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-apple-float transition-transform duration-300 ease-spring hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      </button>
    </div>
  )
}
