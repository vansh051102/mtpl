'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { MetricCard } from '@/components/ui/metric-card'
import { useCurrentUser } from '@/lib/use-current-user'
import { useDashboardData } from '@/components/dashboard/use-dashboard-data'
import { useDashboardRoleGuard } from '@/components/dashboard/use-dashboard-role-guard'
import { RecentLeadsCard } from '@/components/dashboard/recent-leads-card'
import { ViewAsBanner } from '@/components/ViewAsBanner'

export default function MarketingDashboardPage() {
  return <Suspense><MarketingDashboardPageContent /></Suspense>
}

function MarketingDashboardPageContent() {
  useDashboardRoleGuard()
  const me = useCurrentUser()
  const searchParams = useSearchParams()
  const viewAsUserId = searchParams.get('viewAs') ?? undefined
  const { stats, recentLeads, error, loading } = useDashboardData(viewAsUserId)

  if (loading) return <div className="text-sm text-muted-foreground">Loading dashboard…</div>
  if (error) return <div className="text-sm text-destructive">{error}</div>
  if (!stats) return null

  return (
    <div className="flex flex-col gap-4">
      {viewAsUserId && <ViewAsBanner viewAsUserId={viewAsUserId} />}
      {me && <p className="text-sm text-muted-foreground">Welcome, {me.fullName}</p>}

      <section aria-label="Marketing insights" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="New leads" helper="intake pool" value={stats.newLeadCount ?? 0} />
        <MetricCard label="Contacted" helper="outreach started" value={stats.contactedCount ?? 0} />
        <MetricCard label="Qualified" helper="ready for sales" value={stats.qualifiedCount ?? 0} />
      </section>

      {stats.kpi && (
        <section aria-label="Performance KPIs" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard label="Recently active" helper="last 7 days" value={stats.kpi.recentlyActiveCount} />
          <MetricCard
            label="Highest quotation value"
            value={stats.kpi.highestQuotationValue != null ? `₹${stats.kpi.highestQuotationValue.toLocaleString('en-IN')}` : '—'}
          />
          <MetricCard
            label="Highest order value"
            value={stats.kpi.highestOrderValue != null ? `₹${stats.kpi.highestOrderValue.toLocaleString('en-IN')}` : '—'}
          />
          <MetricCard
            label="Highest margin"
            value={stats.kpi.highestMargin != null ? `${stats.kpi.highestMargin}%` : '—'}
          />
          <MetricCard label="Total calls" value={stats.kpi.totalCalls} />
          <MetricCard label="Total messages" value={stats.kpi.totalMessages} />
        </section>
      )}

      <RecentLeadsCard leads={recentLeads} />
    </div>
  )
}
