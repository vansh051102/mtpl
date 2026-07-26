'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MetricCard } from '@/components/ui/metric-card'
import { useCurrentUser } from '@/lib/use-current-user'
import { visibleStagesForRole } from '@/lib/lead-stages'
import { useDashboardData } from '@/components/dashboard/use-dashboard-data'
import { useDashboardRoleGuard } from '@/components/dashboard/use-dashboard-role-guard'
import { RecentLeadsCard } from '@/components/dashboard/recent-leads-card'
import { QuotationChangesCard } from '@/components/dashboard/quotation-changes-card'
import { FlaggedDisqualificationsCard } from '@/components/dashboard/flagged-disqualifications-card'
import { ClosingHorizonCard } from '@/components/dashboard/closing-horizon-card'
import { HighMarginLeadsCard } from '@/components/dashboard/high-margin-leads-card'
import { RegionalRevenueCard } from '@/components/dashboard/regional-revenue-card'
import { ImportExportActivityCard } from '@/components/dashboard/import-export-activity-card'
import { RepConversionCard } from '@/components/dashboard/rep-conversion-card'
import { ViewAsBanner } from '@/components/ViewAsBanner'

export default function AdminDashboardPage() {
  return <Suspense><AdminDashboardPageContent /></Suspense>
}

function AdminDashboardPageContent() {
  useDashboardRoleGuard()
  const me = useCurrentUser()
  const searchParams = useSearchParams()
  const viewAsUserId = searchParams.get('viewAs') ?? undefined
  const { stats, recentLeads, error, loading } = useDashboardData(viewAsUserId)

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading dashboard…</div>
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {viewAsUserId && <ViewAsBanner viewAsUserId={viewAsUserId} />}
      {me && (
        <p className="text-sm text-muted-foreground">
          Welcome, {me.fullName}
          {me.department && ` — ${me.department}`}
          {me.designation && `, ${me.designation}`}
        </p>
      )}

      <section aria-label="Overview insights" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total leads" helper="visible in this workspace" value={stats?.total ?? 0} />
        <MetricCard label="Open leads" helper="still in pipeline" value={stats?.open ?? 0} />
        <MetricCard label="SLA breached" helper="needs attention" value={stats?.slaBreached ?? 0} />
        <MetricCard
          label="Orders confirmed"
          helper="won deals"
          value={
            (stats?.byStage['Order Confirmed'] ?? 0) +
            (stats?.byStage['Order Closed'] ?? 0) +
            (stats?.byStage['Closed Won'] ?? 0)
          }
        />
      </section>

      {stats?.kpi && (
        <section aria-label="Performance KPIs" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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

      <Card>
        <CardHeader>
          <CardTitle>Leads by Stage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {visibleStagesForRole(me?.role ?? 'admin').map((stage) => (
            <Badge key={stage} variant="default">
              {stage}: {stats?.byStage[stage] ?? 0}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <RecentLeadsCard leads={recentLeads} />

      {/* Quotation changes — only shown to admins when data exists */}
      {stats?.recentQuoteSents && stats.recentQuoteSents.length > 0 && (
        <QuotationChangesCard leads={stats.recentQuoteSents} />
      )}

      {stats?.flaggedDisqualifications && stats.flaggedDisqualifications.length > 0 && (
        <FlaggedDisqualificationsCard rows={stats.flaggedDisqualifications} />
      )}

      {stats?.pipelineByClosingHorizon && <ClosingHorizonCard byHorizon={stats.pipelineByClosingHorizon} />}

      {stats?.highMarginLeads && stats.highMarginLeads.length > 0 && (
        <HighMarginLeadsCard leads={stats.highMarginLeads} />
      )}

      {stats?.regionalRevenue && stats.regionalRevenue.length > 0 && (
        <RegionalRevenueCard rows={stats.regionalRevenue} />
      )}

      <RepConversionCard />

      {stats?.recentImportExportActivity && stats.recentImportExportActivity.length > 0 && (
        <ImportExportActivityCard rows={stats.recentImportExportActivity} />
      )}
    </div>
  )
}
