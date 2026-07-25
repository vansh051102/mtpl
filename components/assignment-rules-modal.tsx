'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ModalContentSkeleton } from '@/components/ui/skeleton-variants'

interface OrgUser {
  id: string
  fullName: string
  email: string
}

interface Rule {
  id: string
  source: string
  weekday: number | null
  productCategory: string | null
  assignedToId: string
  isActive: boolean
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const cellClass =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary'

// Admin-only workspace auto-assignment rules editor: Source · Day · Product
// Category · Assign to · Active. Mirrors a reference competitor's Assignment Rules dialog.
export function AssignmentRulesModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [rules, setRules] = useState<Rule[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Draft (unsaved) new rule.
  const [draft, setDraft] = useState<Omit<Rule, 'id'> | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)

  async function load() {
    try {
      const [rulesRes, usersRes] = await Promise.all([
        api.get<Rule[]>('/assignment-rules'),
        api.get<OrgUser[]>('/users'),
      ])
      setRules(rulesRes.data ?? [])
      setUsers((usersRes.data ?? []).filter(Boolean))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function updateRule(id: string, patch: Partial<Rule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    try {
      await api.put(`/assignment-rules/${id}`, patch)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update rule')
      load()
    }
  }

  async function deleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
    try {
      await api.delete(`/assignment-rules/${id}`)
      toast('Rule deleted')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete rule')
      load()
    }
  }

  function startDraft() {
    setDraft({
      source: '',
      weekday: null,
      productCategory: null,
      assignedToId: users[0]?.id ?? '',
      isActive: true,
    })
  }

  async function saveDraft() {
    if (!draft || !draft.source.trim() || !draft.assignedToId) {
      setError('Source and assignee are required.')
      return
    }
    setSavingDraft(true)
    setError(null)
    try {
      const res = await api.post<Rule>('/assignment-rules', {
        source: draft.source.trim(),
        weekday: draft.weekday,
        productCategory: draft.productCategory?.trim() || null,
        assignedToId: draft.assignedToId,
        isActive: draft.isActive,
      })
      if (res.data) setRules((prev) => [...prev, res.data as Rule])
      setDraft(null)
      toast('Rule added')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add rule')
    } finally {
      setSavingDraft(false)
    }
  }

  return (
    <Modal title="Assignment Rules" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>Create workspace-level auto-assignment rules for lead source, weekday and product category.</p>
          <p>Rules apply only when a lead is created. Leads without a matching rule stay on the default assignment.</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <ModalContentSkeleton variant="list" />
        ) : (
          <div className="flex flex-col gap-3">
            {/* Header */}
            <div className="hidden grid-cols-[1.2fr_1fr_1.2fr_1.4fr_auto_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Source</span>
              <span>Day</span>
              <span>Category</span>
              <span>Assign to</span>
              <span>Active</span>
              <span></span>
            </div>

            {rules.length === 0 && !draft && (
              <p className="text-sm text-muted-foreground">No rules yet. Add one below.</p>
            )}

            {rules.map((rule) => (
              <div
                key={rule.id}
                className="grid grid-cols-2 items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[1.2fr_1fr_1.2fr_1.4fr_auto_auto]"
              >
                <input
                  aria-label="Source"
                  value={rule.source}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((r) => (r.id === rule.id ? { ...r, source: e.target.value } : r))
                    )
                  }
                  onBlur={(e) => updateRule(rule.id, { source: e.target.value })}
                  className={cellClass}
                />
                <select
                  aria-label="Day"
                  value={rule.weekday ?? ''}
                  onChange={(e) =>
                    updateRule(rule.id, {
                      weekday: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className={cellClass}
                >
                  <option value="">Any day</option>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Product category"
                  value={rule.productCategory ?? ''}
                  placeholder="Any"
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((r) =>
                        r.id === rule.id ? { ...r, productCategory: e.target.value } : r
                      )
                    )
                  }
                  onBlur={(e) =>
                    updateRule(rule.id, { productCategory: e.target.value.trim() || null })
                  }
                  className={cellClass}
                />
                <select
                  aria-label="Assign to"
                  value={rule.assignedToId}
                  onChange={(e) => updateRule(rule.id, { assignedToId: e.target.value })}
                  className={cellClass}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
                <label className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="Active"
                    checked={rule.isActive}
                    onChange={(e) => updateRule(rule.id, { isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => deleteRule(rule.id)}
                  aria-label="Delete rule"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-muted"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            {/* Draft row */}
            {draft && (
              <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-primary/50 bg-muted/40 p-2 sm:grid-cols-[1.2fr_1fr_1.2fr_1.4fr_auto_auto]">
                <input
                  aria-label="New rule source"
                  value={draft.source}
                  placeholder="e.g. IndiaMART"
                  onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                  className={cellClass}
                />
                <select
                  aria-label="New rule day"
                  value={draft.weekday ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      weekday: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  className={cellClass}
                >
                  <option value="">Any day</option>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="New rule category"
                  value={draft.productCategory ?? ''}
                  placeholder="Any"
                  onChange={(e) => setDraft({ ...draft, productCategory: e.target.value })}
                  className={cellClass}
                />
                <select
                  aria-label="New rule assignee"
                  value={draft.assignedToId}
                  onChange={(e) => setDraft({ ...draft, assignedToId: e.target.value })}
                  className={cellClass}
                >
                  <option value="">Select…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
                <label className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="New rule active"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                </label>
                <span />
              </div>
            )}

            <div className="flex items-center justify-between">
              {draft ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveDraft} disabled={savingDraft}>
                    {savingDraft ? 'Saving…' : 'Save rule'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={startDraft} disabled={users.length === 0}>
                  <Plus className="h-4 w-4" />
                  Add rule
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
