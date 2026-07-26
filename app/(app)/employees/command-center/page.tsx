'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageSkeleton } from '@/components/ui/skeleton-variants'
import { useCurrentUser } from '@/lib/use-current-user'
import { dashboardRouteForRole } from '@/lib/dashboard-routes'

interface EmployeeRow {
  id: string
  fullName: string
  department: string | null
  designation: string | null
  role: string
  liveAvailability: 'ONLINE' | 'OFFLINE'
  kraScore: number | null
  slaPct: number | null
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

function topBy(rows: EmployeeRow[], pick: (r: EmployeeRow) => number | null, label: string) {
  const ranked = rows
    .map((r) => ({ r, value: pick(r) }))
    .filter((x): x is { r: EmployeeRow; value: number } => x.value !== null)
    .sort((a, b) => b.value - a.value)
  if (ranked.length === 0) return { label, name: '—', value: null as number | null }
  return { label, name: ranked[0].r.fullName, value: ranked[0].value }
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
  const leaderboard = [
    topBy(list, (r) => r.kraScore, 'Best KRA score'),
    topBy(list, (r) => r.slaPct, 'Best SLA %'),
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {leaderboard.map((entry) => (
            <div key={entry.label} className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">{entry.label}</p>
              <p className="text-lg font-semibold text-foreground">{entry.name}</p>
              {entry.value !== null && <p className="text-xs text-muted-foreground">{entry.value}</p>}
            </div>
          ))}
        </CardContent>
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Attendance leaderboard skipped — no presence-history table exists yet to back it honestly.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee Matrix</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
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
                    <Badge variant={row.liveAvailability === 'ONLINE' ? 'success' : 'default'}>
                      {row.liveAvailability}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">
                    {row.kraScore !== null ? row.kraScore.toFixed(1) : 'collecting'}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-foreground">
                    {row.slaPct !== null ? `${row.slaPct}%` : '—'}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    No employees found for this scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
