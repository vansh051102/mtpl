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
import { GlassHeader } from '@/components/dashboards/shared/GlassHeader'
import { HeroHealthRing } from '@/components/dashboards/shared/HeroHealthRing'
import { PriorityList } from '@/components/dashboards/shared/PriorityList'
import { SingleMetricStrip } from '@/components/dashboards/shared/SingleMetricStrip'
import { Scorecard } from '@/components/dashboards/shared/Scorecard'
import { GoalsCard } from '@/components/dashboards/shared/GoalsCard'
import { CalendarWidget } from '@/components/dashboards/shared/CalendarWidget'
import { CustomerHealthCard, type CustomerRow } from '@/components/dashboards/shared/CustomerHealthCard'
import { SupplierHealthCard, type SupplierRow } from '@/components/dashboards/shared/SupplierHealthCard'
import { ActivityTimeline } from '@/components/dashboards/shared/ActivityTimeline'
import { SearchBar } from '@/components/dashboards/shared/SearchBar'
import { CommandPalette } from '@/components/dashboards/shared/CommandPalette'
import { DepartmentComparisonRow } from '@/components/dashboards/shared/DepartmentComparisonRow'
import { SlaHeatmap } from '@/components/dashboards/shared/SlaHeatmap'
import { GlobalFilterBar } from '@/components/global-filter-bar'
import { NotificationCenter } from '@/components/notification-center'
import { QuickActionMenu } from '@/components/quick-action-menu'
import { DataFreshness } from '@/components/data-freshness'
import { getShiftPhase, SHIFT_PHASE_LABEL } from '@/lib/shift-phase'
import type { Priority } from '@/lib/executive-priorities'
import type { BusinessHealth } from '@/lib/business-health'
import type { SalesScorecard, LeadGenScorecard, PurchaseScorecard } from '@/lib/department-scorecards'
import type { DepartmentComparisonEntry } from '@/lib/department-comparison'
import type { ActivityFeedItem } from '@/lib/activity-feed'

interface ControlPlaneData {
  health: BusinessHealth
  priorities: Priority[]
  scorecards: { sales: SalesScorecard; leadGen: LeadGenScorecard; purchase: PurchaseScorecard }
  goals: { department: string; metric: string; targetValue: number; achievedValue: number; achievedPct: number }[]
  tasksToday: { id: string; title: string; dueAt: string; type: string }[]
  departmentComparison: DepartmentComparisonEntry[]
  activityFeed: ActivityFeedItem[]
}

function useControlPlane() {
  const [data, setData] = useState<ControlPlaneData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    return api
      .get<ControlPlaneData>('/command-center/control-plane')
      .then((res) => {
        setData(res.data ?? null)
        setLastUpdated(new Date())
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Failed to load control plane')
      })
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }

  useEffect(() => {
    load()
  }, [])

  return { data, error, loading, refreshing, lastUpdated, refetch: () => load(true) }
}

function useCustomersAndSuppliers() {
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .get<CustomerRow[]>('/customers?limit=8')
      .then((res) => {
        if (!cancelled) setCustomers(res.data ?? [])
      })
      .catch(() => undefined)
    api
      .get<SupplierRow[]>('/suppliers?limit=8')
      .then((res) => {
        if (!cancelled) setSuppliers(res.data ?? [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return { customers, suppliers }
}

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
  const { data: controlPlane, loading: controlPlaneLoading, refreshing, lastUpdated, refetch } = useControlPlane()
  const { customers, suppliers } = useCustomersAndSuppliers()
  const shiftPhase = getShiftPhase(new Date())

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
      <GlassHeader
        title={`Good ${shiftPhase === 'Daily Review' ? 'evening' : 'day'}, ${me?.fullName ?? ''}`}
        shiftPhase={SHIFT_PHASE_LABEL[shiftPhase]}
        right={
          <div className="flex items-center gap-2">
            <DataFreshness lastUpdated={lastUpdated} onRefresh={refetch} refreshing={refreshing} />
            <SearchBar />
            <NotificationCenter />
          </div>
        }
      />
      <CommandPalette />
      <QuickActionMenu />

      <GlobalFilterBar />

      <section aria-label="Today's attention" role="status" aria-live="polite" aria-busy={controlPlaneLoading}>
        {controlPlaneLoading ? (
          <div className="h-10 animate-pulse rounded-xl bg-muted" />
        ) : (
          <PriorityList priorities={controlPlane?.priorities ?? []} />
        )}
      </section>

      <section aria-label="Business health" className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex items-center justify-center rounded-3xl p-6 shadow-apple-card">
          <HeroHealthRing score={controlPlane?.health.overallScore ?? 0} />
        </Card>
        <SingleMetricStrip
          items={[
            { label: 'Revenue this month', value: `₹${(controlPlane?.scorecards.sales.revenue ?? 0).toLocaleString('en-IN')}`, href: '/leads?department=Sales' },
            { label: 'Quotes pending', value: String(controlPlane?.scorecards.sales.quotesPending ?? 0), href: '/leads?stage=Quote+Sent' },
            { label: 'RFQs pending', value: String(controlPlane?.scorecards.purchase.pendingRfqs ?? 0), href: '/purchase?status=pending' },
          ]}
        />
      </section>

      <section aria-label="Department scorecards" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Scorecard
          title="Sales"
          fields={[
            { label: 'Revenue', value: `₹${(controlPlane?.scorecards.sales.revenue ?? 0).toLocaleString('en-IN')}` },
            { label: 'Target %', value: controlPlane?.scorecards.sales.targetPct ?? null },
            { label: 'Orders', value: controlPlane?.scorecards.sales.orders ?? 0 },
            { label: 'Quotes Sent', value: controlPlane?.scorecards.sales.quotesSent ?? 0 },
            { label: 'Quotes Pending', value: controlPlane?.scorecards.sales.quotesPending ?? 0 },
            { label: 'Win Rate', value: `${controlPlane?.scorecards.sales.winRate ?? 0}%` },
            { label: 'SLA %', value: `${Math.round(controlPlane?.scorecards.sales.slaPct ?? 0)}%` },
            { label: 'KRA Score', value: controlPlane?.scorecards.sales.kraScore != null ? Math.round(controlPlane.scorecards.sales.kraScore) : null },
          ]}
        />
        <Scorecard
          title="Lead Generation"
          fields={[
            { label: 'New Leads', value: controlPlane?.scorecards.leadGen.newLeads ?? 0 },
            { label: 'Qualified', value: controlPlane?.scorecards.leadGen.qualified ?? 0 },
            { label: 'Disqualified', value: controlPlane?.scorecards.leadGen.disqualified ?? 0 },
            { label: 'Lead-to-Sales %', value: `${controlPlane?.scorecards.leadGen.leadToSalesPct ?? 0}%` },
            { label: 'First Call SLA', value: `${Math.round(controlPlane?.scorecards.leadGen.firstCallSlaPct ?? 0)}%` },
            { label: 'KRA Score', value: controlPlane?.scorecards.leadGen.kraScore != null ? Math.round(controlPlane.scorecards.leadGen.kraScore) : null },
          ]}
        />
        <Scorecard
          title="Purchase"
          fields={[
            { label: 'RFQs', value: controlPlane?.scorecards.purchase.rfqs ?? 0 },
            { label: 'Pending RFQs', value: controlPlane?.scorecards.purchase.pendingRfqs ?? 0 },
            { label: 'Purchase Orders', value: controlPlane?.scorecards.purchase.purchaseOrders ?? 0 },
            { label: 'SLA', value: `${Math.round(controlPlane?.scorecards.purchase.slaPct ?? 0)}%` },
            { label: 'KRA Score', value: controlPlane?.scorecards.purchase.kraScore != null ? Math.round(controlPlane.scorecards.purchase.kraScore) : null },
          ]}
        />
      </section>

      <section aria-label="Customer and supplier health" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CustomerHealthCard customers={customers} />
        <SupplierHealthCard suppliers={suppliers} />
      </section>

      <section aria-label="Goals and calendar" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <GoalsCard goals={controlPlane?.goals ?? []} />
        <CalendarWidget items={controlPlane?.tasksToday ?? []} />
      </section>

      <section aria-label="Department comparison and SLA" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-3xl p-4 shadow-apple-card">
          <h3 className="mb-2 px-1 font-display text-base text-foreground">Department Comparison</h3>
          <DepartmentComparisonRow entries={controlPlane?.departmentComparison ?? []} />
        </Card>
        <Card className="rounded-3xl p-4 shadow-apple-card">
          <h3 className="mb-3 px-1 font-display text-base text-foreground">SLA Heatmap</h3>
          <SlaHeatmap
            rows={[
              { department: 'Sales', pct: controlPlane?.scorecards.sales.slaPct ?? 0 },
              { department: 'Lead Gen', pct: controlPlane?.scorecards.leadGen.firstCallSlaPct ?? 0 },
              { department: 'Purchase', pct: controlPlane?.scorecards.purchase.slaPct ?? 0 },
            ]}
          />
        </Card>
      </section>

      <section aria-label="Activity feed">
        <ActivityTimeline items={controlPlane?.activityFeed ?? []} />
      </section>

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
