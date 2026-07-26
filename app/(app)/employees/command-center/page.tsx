'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageSkeleton } from '@/components/ui/skeleton-variants'
import { useCurrentUser } from '@/lib/use-current-user'
import { dashboardRouteForRole } from '@/lib/dashboard-routes'
import { Leaderboard } from '@/components/dashboards/shared/Leaderboard'
import type { EmployeeStatus } from '@/lib/employee-status'

interface EmployeeRow {
  id: string
  fullName: string
  department: string | null
  designation: string | null
  role: string
  status: EmployeeStatus
  kraScore: number | null
  slaPct: number | null
}

const STATUS_VARIANT: Record<EmployeeStatus, 'success' | 'warning' | 'default'> = {
  AVAILABLE: 'success',
  BUSY: 'warning',
  ON_CALL: 'warning',
  OFFLINE: 'default',
}

const MATRIX_ROLES = ['admin', 'sales_manager', 'marketing_manager']

function useEmployeeMatrix() {
  const [rows, setRows] = useState<EmployeeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.get<EmployeeRow[]>('/command-center/employee-matrix')
        if (cancelled) return
        setRows(res.data ?? [])
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Failed to load employee matrix')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { rows, error, loading }
}

export default function EmployeeCommandCenterPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EmployeeCommandCenterContent />
    </Suspense>
  )
}

function EmployeeCommandCenterContent() {
  const me = useCurrentUser()
  const router = useRouter()
  const { rows, error, loading } = useEmployeeMatrix()
  const [view, setView] = useState<'grid' | 'table'>('grid')

  useEffect(() => {
    if (me && !MATRIX_ROLES.includes(me.role)) {
      router.replace(dashboardRouteForRole(me.role))
    }
  }, [me, router])

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <PageSkeleton />
        <span className="sr-only">Loading employee command center…</span>
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>
  }

  const list = rows ?? []
  const rankedByKra = list
    .filter((r): r is EmployeeRow & { kraScore: number } => r.kraScore !== null)
    .sort((a, b) => b.kraScore - a.kraScore)
  const top5 = rankedByKra.slice(0, 5)
  const bottom5 = rankedByKra.slice(-5).reverse()
  const slaLeaderboard = list
    .filter((r): r is EmployeeRow & { slaPct: number } => r.slaPct !== null)
    .sort((a, b) => b.slaPct - a.slaPct)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>KRA Ranking</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Leaderboard
              title="Top 5"
              rows={top5.map((r) => ({ id: r.id, name: r.fullName, value: Math.round(r.kraScore) }))}
              hrefFor={() => '#'}
            />
            <Leaderboard
              title="Bottom 5"
              rows={bottom5.map((r) => ({ id: r.id, name: r.fullName, value: Math.round(r.kraScore) }))}
              hrefFor={() => '#'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SLA Leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <Leaderboard
              title="Ranked by SLA %"
              rows={slaLeaderboard.map((r) => ({ id: r.id, name: r.fullName, value: r.slaPct, suffix: '%' }))}
              hrefFor={() => '#'}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Employee Matrix</CardTitle>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Table
            </button>
          </div>
        </CardHeader>
        <CardContent className={view === 'table' ? 'overflow-x-auto' : undefined}>
          {list.length === 0 && <p className="py-4 text-center text-muted-foreground">No employees found for this scope.</p>}

          {list.length > 0 && view === 'grid' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((row) => (
                <div key={row.id} className="rounded-3xl border border-border p-4 shadow-apple-card transition-all duration-300 ease-spring hover:-translate-y-0.5 hover:shadow-apple-float">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-foreground">{row.fullName}</p>
                    <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.department ?? '—'} · {row.designation ?? '—'}
                  </p>
                  <div className="mt-3 flex justify-between text-sm">
                    <span className="text-muted-foreground">KRA</span>
                    <span className="tabular-nums text-foreground">{row.kraScore !== null ? row.kraScore.toFixed(1) : 'collecting'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SLA</span>
                    <span className="tabular-nums text-foreground">{row.slaPct !== null ? `${row.slaPct}%` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {list.length > 0 && view === 'table' && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Designation</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">KRA Score</th>
                  <th className="py-2 pr-3">SLA %</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 text-foreground">{row.fullName}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.department ?? '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{row.designation ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-foreground">
                      {row.kraScore !== null ? row.kraScore.toFixed(1) : 'collecting'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-foreground">
                      {row.slaPct !== null ? `${row.slaPct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
