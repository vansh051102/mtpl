'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

interface AnomalyRow {
  id: string
  userId: string
  userName: string
  contactId: string | null
  flagType: string
  severity: string
  description: string
  flaggedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolution: string | null
}

const SEVERITY_BADGE: Record<string, string> = {
  HIGH: 'bg-red-500/10 text-red-600 dark:text-red-400',
  MEDIUM: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  LOW: 'bg-muted text-muted-foreground',
}

const FLAG_LABEL: Record<string, string> = {
  VELOCITY_SPIKE: 'Velocity spike',
  DURATION_MISMATCH: 'Duration mismatch',
  MODAL_SPAM: 'Call log spam',
}

export default function AnomalyQueuePage() {
  const { toast } = useToast()
  const [flags, setFlags] = useState<AnomalyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [resolvingFlag, setResolvingFlag] = useState<AnomalyRow | null>(null)
  const [resolution, setResolution] = useState('')
  const [resolving, setResolving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setForbidden(false)
    try {
      const params = new URLSearchParams({ limit: '50', resolved: String(showResolved) })
      const res = await api.get<AnomalyRow[]>(`/admin/anomalies?${params}`)
      setFlags(res.data ?? [])
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 403) {
        setForbidden(true)
      } else {
        toast('Failed to load anomaly queue', 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [showResolved, toast])

  useEffect(() => {
    void load()
  }, [load])

  function openResolve(flag: AnomalyRow) {
    setResolution('')
    setResolvingFlag(flag)
  }

  async function submitResolve(e: React.FormEvent) {
    e.preventDefault()
    if (!resolvingFlag) return
    setResolving(true)
    try {
      await api.post(`/admin/anomalies/${resolvingFlag.id}/resolve`, { resolution })
      toast('Flag resolved')
      setResolvingFlag(null)
      await load()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to resolve flag', 'error')
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">Anomaly Queue</h1>
        <p className="text-sm text-muted-foreground">
          Anti-gaming flags for review — velocity spikes, CTI/manual call duration mismatches, and
          call-log modal spam. Flags never auto-block; they surface here for a manager decision.
        </p>
      </div>

      {forbidden ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Admin access required to view the anomaly queue.
        </div>
      ) : (
      <>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        <button
          type="button"
          onClick={() => setShowResolved(false)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            !showResolved ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
        >
          Unresolved
        </button>
        <button
          type="button"
          onClick={() => setShowResolved(true)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            showResolved ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
          )}
        >
          Resolved
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">User</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Severity</th>
              <th className="px-3 py-2.5 font-medium">Description</th>
              <th className="px-3 py-2.5 font-medium">Flagged</th>
              {showResolved && <th className="px-3 py-2.5 font-medium">Resolution</th>}
              {!showResolved && <th className="px-3 py-2.5 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-3 py-2.5">
                      <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : flags.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No {showResolved ? 'resolved' : 'unresolved'} flags.
                </td>
              </tr>
            ) : (
              flags.map((f) => (
                <tr key={f.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5 font-medium">{f.userName}</td>
                  <td className="px-3 py-2.5">{FLAG_LABEL[f.flagType] ?? f.flagType}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
                        SEVERITY_BADGE[f.severity] ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{f.description}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(f.flaggedAt).toLocaleString()}
                  </td>
                  {showResolved ? (
                    <td className="px-3 py-2.5 text-muted-foreground">{f.resolution ?? '—'}</td>
                  ) : (
                    <td className="px-3 py-2.5">
                      <Button size="sm" variant="outline" onClick={() => openResolve(f)}>
                        Resolve
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>
      )}

      {resolvingFlag && (
        <Modal title="Resolve anomaly flag" onClose={() => setResolvingFlag(null)}>
          <form onSubmit={submitResolve} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {FLAG_LABEL[resolvingFlag.flagType] ?? resolvingFlag.flagType} — {resolvingFlag.userName}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Resolution
              <textarea
                required
                rows={3}
                className="h-auto rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Reviewed call recordings, duration confirmed accurate"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setResolvingFlag(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={resolving}
                className={cn(resolving && 'opacity-60 disabled:cursor-not-allowed')}
              >
                Resolve
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
