'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MetricCard } from '@/components/ui/metric-card'
import { PageSkeleton } from '@/components/ui/skeleton-variants'
import { TrafficLightCard } from '@/components/dashboard/traffic-light-card'
import { OwnerMorningChecklist } from '@/components/dashboard/owner-morning-checklist'
import { useCurrentUser } from '@/lib/use-current-user'
import { dashboardRouteForRole } from '@/lib/dashboard-routes'

interface AnomalyFlagRow {
  id: string
  flagType: string
  severity: string
  description: string
  flaggedAt: string
}

interface DepartmentHealthRow {
  department: string
  health: string
  score: string | number
  metricsJson: Record<string, unknown>
  calculatedAt: string
}

interface ExecutiveData {
  now: string
  presentCount: number
  totalCount: number
  topAlerts: AnomalyFlagRow[]
  departments: DepartmentHealthRow[]
}

const SEVERITY_VARIANT: Record<string, 'destructive' | 'warning' | 'default'> = {
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'default',
}

function useCommandCenterExecutive() {
  const [data, setData] = useState<ExecutiveData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await api.get<ExecutiveData>('/command-center/executive')
        if (cancelled) return
        setData(res.data ?? null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Failed to load command center')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return { data, error, loading }
}

export default function ExecutiveDashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExecutiveDashboardPageContent />
    </Suspense>
  )
}

function ExecutiveDashboardPageContent() {
  const me = useCurrentUser()
  const router = useRouter()
  const { data, error, loading } = useCommandCenterExecutive()

  useEffect(() => {
    if (me && me.role !== 'admin') {
      router.replace(dashboardRouteForRole(me.role))
    }
  }, [me, router])

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <PageSkeleton />
        <span className="sr-only">Loading command center…</span>
      </div>
    )
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Welcome, {me?.fullName}
        {' — '}
        {new Date(data?.now ?? Date.now()).toLocaleString()}
      </p>

      <section aria-label="Presence overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Present now" helper="online in the last 15 min" value={data?.presentCount ?? 0} />
        <MetricCard label="Total active users" helper="org headcount" value={data?.totalCount ?? 0} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Owner Alerts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(!data?.topAlerts || data.topAlerts.length === 0) && (
            <p className="text-sm text-muted-foreground">No unresolved alerts.</p>
          )}
          {data?.topAlerts.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
              <span className="text-sm text-foreground">{alert.description}</span>
              <Badge variant={SEVERITY_VARIANT[alert.severity] ?? 'default'}>{alert.severity}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <section aria-label="Department health" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data?.departments.map((dept) => (
          <TrafficLightCard
            key={dept.department}
            department={dept.department}
            health={dept.health}
            score={Number(dept.score)}
            metrics={dept.metricsJson}
          />
        ))}
      </section>

      <OwnerMorningChecklist />
    </div>
  )
}
