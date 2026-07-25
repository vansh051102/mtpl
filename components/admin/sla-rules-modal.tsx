'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ALL_STAGES } from '@/lib/lead-stages'
import { ModalContentSkeleton } from '@/components/ui/skeleton-variants'

interface SlaRule {
  id: string
  department: string | null
  stage: string
  trigger: string
  targetMinutes: number | null
  warningPct: number
  isActive: boolean
}

const TRIGGERS = ['stage_entered', 'quote_sent']

const cellClass =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary'

// Admin-only SLA target editor: Department · Stage · Trigger · Target (hours) ·
// Warning % · Active. Empty target = data-collection-only, no breach possible —
// this is the config surface for lib/sla-engine.ts:startSlaClock.
export function SlaRulesModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [rules, setRules] = useState<SlaRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<SlaRule, 'id'> | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    api
      .get<SlaRule[]>('/admin/sla-rules')
      .then((res) => setRules(res.data ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load SLA rules'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function updateRule(id: string, patch: Partial<SlaRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    try {
      await api.put(`/admin/sla-rules/${id}`, patch)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update rule')
      load()
    }
  }

  async function deleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
    try {
      await api.delete(`/admin/sla-rules/${id}`)
      toast('SLA rule deleted')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete rule')
      load()
    }
  }

  function startDraft() {
    setDraft({
      department: null,
      stage: ALL_STAGES[0],
      trigger: 'stage_entered',
      targetMinutes: null,
      warningPct: 80,
      isActive: true,
    })
  }

  async function saveDraft() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.post<SlaRule>('/admin/sla-rules', draft)
      if (res.data) setRules((prev) => [...prev, res.data as SlaRule])
      setDraft(null)
      toast('SLA rule added')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="SLA Rules" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Target duration per department/stage/trigger. Leave target blank to collect timing data
          without enforcing a breach — the recommended starting point before targets are known.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <ModalContentSkeleton variant="list" />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="hidden grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_auto_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Department</span>
              <span>Stage</span>
              <span>Trigger</span>
              <span>Target (hrs)</span>
              <span>Warn %</span>
              <span>Active</span>
              <span></span>
            </div>

            {rules.length === 0 && !draft && (
              <p className="text-sm text-muted-foreground">
                No SLA rules yet — stages fall back to the defaults set in Lead Workflow.
              </p>
            )}

            {rules.map((rule) => (
              <div
                key={rule.id}
                className="grid grid-cols-2 items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_auto_auto]"
              >
                <input
                  aria-label="Department"
                  value={rule.department ?? ''}
                  placeholder="Any"
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((r) => (r.id === rule.id ? { ...r, department: e.target.value } : r))
                    )
                  }
                  onBlur={(e) => updateRule(rule.id, { department: e.target.value.trim() || null })}
                  className={cellClass}
                />
                <select
                  aria-label="Stage"
                  value={rule.stage}
                  onChange={(e) => updateRule(rule.id, { stage: e.target.value })}
                  className={cellClass}
                >
                  {ALL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Trigger"
                  value={rule.trigger}
                  onChange={(e) => updateRule(rule.id, { trigger: e.target.value })}
                  className={cellClass}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Target hours"
                  type="number"
                  min={0}
                  value={rule.targetMinutes != null ? rule.targetMinutes / 60 : ''}
                  placeholder="Collect only"
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((r) =>
                        r.id === rule.id
                          ? { ...r, targetMinutes: e.target.value === '' ? null : Number(e.target.value) * 60 }
                          : r
                      )
                    )
                  }
                  onBlur={(e) =>
                    updateRule(rule.id, {
                      targetMinutes: e.target.value === '' ? null : Number(e.target.value) * 60,
                    })
                  }
                  className={cellClass}
                />
                <input
                  aria-label="Warning percent"
                  type="number"
                  min={1}
                  max={100}
                  value={rule.warningPct}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((r) => (r.id === rule.id ? { ...r, warningPct: Number(e.target.value) } : r))
                    )
                  }
                  onBlur={(e) => updateRule(rule.id, { warningPct: Number(e.target.value) })}
                  className={cellClass}
                />
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

            {draft && (
              <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-primary/50 bg-muted/40 p-2 sm:grid-cols-[1fr_1.2fr_1fr_1fr_0.8fr_auto_auto]">
                <input
                  aria-label="New rule department"
                  value={draft.department ?? ''}
                  placeholder="Any"
                  onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                  className={cellClass}
                />
                <select
                  aria-label="New rule stage"
                  value={draft.stage}
                  onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
                  className={cellClass}
                >
                  {ALL_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="New rule trigger"
                  value={draft.trigger}
                  onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}
                  className={cellClass}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="New rule target hours"
                  type="number"
                  min={0}
                  placeholder="Collect only"
                  value={draft.targetMinutes != null ? draft.targetMinutes / 60 : ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      targetMinutes: e.target.value === '' ? null : Number(e.target.value) * 60,
                    })
                  }
                  className={cellClass}
                />
                <input
                  aria-label="New rule warning percent"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.warningPct}
                  onChange={(e) => setDraft({ ...draft, warningPct: Number(e.target.value) })}
                  className={cellClass}
                />
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
                  <Button size="sm" onClick={saveDraft} disabled={saving}>
                    {saving ? 'Saving…' : 'Save rule'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={startDraft}>
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
