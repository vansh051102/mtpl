'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/api-client'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ModalContentSkeleton } from '@/components/ui/skeleton-variants'

interface KraDefinition {
  id: string
  department: string | null
  metric: string
  label: string
  weight: number | null
  isActive: boolean
}

// Fixed KPI catalog (lib/kpi/metrics.ts, phase 1) — KRAs map department/role to
// one of these, not to a free-text formula.
const METRICS = [
  'leads_created',
  'avg_first_response_minutes',
  'calls_logged',
  'avg_qualification_minutes',
  'quotes_completed',
  'avg_quote_turnaround_minutes',
  'sla_breach_rate',
  'conversion_rate',
]

const cellClass =
  'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary'

// Admin editor mapping department -> KPI metric with a display label, i.e.
// "what counts as this department's Key Result Area." Reads back from
// KpiSnapshot once the KPI rollup cron (phase 1) is live.
export function KraDefinitionsModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [definitions, setDefinitions] = useState<KraDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<KraDefinition, 'id'> | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    api
      .get<KraDefinition[]>('/admin/kra-definitions')
      .then((res) => setDefinitions(res.data ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load KRAs'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  async function updateDefinition(id: string, patch: Partial<KraDefinition>) {
    setDefinitions((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
    try {
      await api.put(`/admin/kra-definitions/${id}`, patch)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update KRA')
      load()
    }
  }

  async function deleteDefinition(id: string) {
    setDefinitions((prev) => prev.filter((d) => d.id !== id))
    try {
      await api.delete(`/admin/kra-definitions/${id}`)
      toast('KRA deleted')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete KRA')
      load()
    }
  }

  function startDraft() {
    setDraft({ department: null, metric: METRICS[0], label: '', weight: null, isActive: true })
  }

  async function saveDraft() {
    if (!draft || !draft.label.trim()) {
      setError('Label is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await api.post<KraDefinition>('/admin/kra-definitions', {
        ...draft,
        label: draft.label.trim(),
      })
      if (res.data) setDefinitions((prev) => [...prev, res.data as KraDefinition])
      setDraft(null)
      toast('KRA added')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add KRA')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Key Result Areas" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Map a department to a KPI metric with a display label, e.g. Sales → avg_first_response_minutes
          → &quot;Response Time&quot;. Dashboards read these once KPI rollups are live.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <ModalContentSkeleton variant="list" />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="hidden grid-cols-[1fr_1.4fr_1.4fr_0.8fr_auto_auto] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Department</span>
              <span>Metric</span>
              <span>Label</span>
              <span>Weight</span>
              <span>Active</span>
              <span></span>
            </div>

            {definitions.length === 0 && !draft && (
              <p className="text-sm text-muted-foreground">No KRAs defined yet.</p>
            )}

            {definitions.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-2 items-center gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1.4fr_1.4fr_0.8fr_auto_auto]"
              >
                <input
                  aria-label="Department"
                  value={d.department ?? ''}
                  placeholder="Org-wide"
                  onChange={(e) =>
                    setDefinitions((prev) =>
                      prev.map((r) => (r.id === d.id ? { ...r, department: e.target.value } : r))
                    )
                  }
                  onBlur={(e) => updateDefinition(d.id, { department: e.target.value.trim() || null })}
                  className={cellClass}
                />
                <select
                  aria-label="Metric"
                  value={d.metric}
                  onChange={(e) => updateDefinition(d.id, { metric: e.target.value })}
                  className={cellClass}
                >
                  {METRICS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Label"
                  value={d.label}
                  onChange={(e) =>
                    setDefinitions((prev) => prev.map((r) => (r.id === d.id ? { ...r, label: e.target.value } : r)))
                  }
                  onBlur={(e) => updateDefinition(d.id, { label: e.target.value.trim() })}
                  className={cellClass}
                />
                <input
                  aria-label="Weight"
                  type="number"
                  min={1}
                  value={d.weight ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    setDefinitions((prev) =>
                      prev.map((r) =>
                        r.id === d.id ? { ...r, weight: e.target.value === '' ? null : Number(e.target.value) } : r
                      )
                    )
                  }
                  onBlur={(e) =>
                    updateDefinition(d.id, { weight: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className={cellClass}
                />
                <label className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label="Active"
                    checked={d.isActive}
                    onChange={(e) => updateDefinition(d.id, { isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => deleteDefinition(d.id)}
                  aria-label="Delete KRA"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-muted"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}

            {draft && (
              <div className="grid grid-cols-2 items-center gap-2 rounded-md border border-primary/50 bg-muted/40 p-2 sm:grid-cols-[1fr_1.4fr_1.4fr_0.8fr_auto_auto]">
                <input
                  aria-label="New KRA department"
                  value={draft.department ?? ''}
                  placeholder="Org-wide"
                  onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                  className={cellClass}
                />
                <select
                  aria-label="New KRA metric"
                  value={draft.metric}
                  onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
                  className={cellClass}
                >
                  {METRICS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="New KRA label"
                  value={draft.label}
                  placeholder="e.g. Response Time"
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className={cellClass}
                />
                <input
                  aria-label="New KRA weight"
                  type="number"
                  min={1}
                  placeholder="—"
                  value={draft.weight ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, weight: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className={cellClass}
                />
                <span />
                <span />
              </div>
            )}

            <div className="flex items-center justify-between">
              {draft ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveDraft} disabled={saving}>
                    {saving ? 'Saving…' : 'Save KRA'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={startDraft}>
                  <Plus className="h-4 w-4" />
                  Add KRA
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
