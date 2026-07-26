import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildOwnershipFilterAsync } from '@/lib/rbac'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { isFlaggedDisqualify } from '@/lib/lead-stages'
import { resolveMaskedFields, applyLeadFieldMask } from '@/lib/lead-serializer'

// Averages the Qualified -> Quote Sent gap across the org from STAGE_CHANGE
// audit entries (lib/auth.ts logAudit, written by the stage-change route).
// Org-wide rather than ownership-filtered: this is a pipeline-velocity
// metric, not per-user data, and a lead's history survives it moving past
// Quote Sent (e.g. to Order Confirmed), which a current-stage filter would miss.
async function computeAvgQualifiedToQuoteSentHours(orgId: string): Promise<number | null> {
  const events = await prisma.auditLog.findMany({
    where: { orgId, resourceType: 'Lead', action: 'STAGE_CHANGE' },
    select: { resourceId: true, changes: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  })

  const enteredQualified = new Map<string, Date>()
  const enteredQuoteSent = new Map<string, Date>()
  for (const event of events) {
    const changes = event.changes as { toStage?: string } | null
    if (changes?.toStage === 'Qualified' && !enteredQualified.has(event.resourceId)) {
      enteredQualified.set(event.resourceId, event.timestamp)
    }
    if (changes?.toStage === 'Quote Sent' && !enteredQuoteSent.has(event.resourceId)) {
      enteredQuoteSent.set(event.resourceId, event.timestamp)
    }
  }

  const diffsHours: number[] = []
  for (const [leadId, quoteSentAt] of enteredQuoteSent) {
    const qualifiedAt = enteredQualified.get(leadId)
    if (!qualifiedAt) continue
    const hours = (quoteSentAt.getTime() - qualifiedAt.getTime()) / (1000 * 60 * 60)
    if (hours >= 0) diffsHours.push(hours)
  }

  if (diffsHours.length === 0) return null
  return Math.round((diffsHours.reduce((a, b) => a + b, 0) / diffsHours.length) * 10) / 10
}

// Counts leads disqualified from Qualified/Quote Sent (the flagged, late-funnel
// exception — see lib/lead-stages.ts isFlaggedDisqualify) per salesperson, from
// existing STAGE_CHANGE audit entries. No new tracking needed — every stage
// change already records who did it and the from/to stage.
async function computeFlaggedDisqualifications(orgId: string) {
  const events = await prisma.auditLog.findMany({
    where: { orgId, resourceType: 'Lead', action: 'STAGE_CHANGE' },
    select: { userId: true, changes: true, timestamp: true, user: { select: { fullName: true } } },
    orderBy: { timestamp: 'desc' },
  })

  const byUser = new Map<string, { fullName: string; count: number; lastAt: Date }>()
  for (const event of events) {
    const changes = event.changes as { fromStage?: string; toStage?: string } | null
    if (!changes?.fromStage || !changes?.toStage) continue
    if (!isFlaggedDisqualify(changes.fromStage, changes.toStage)) continue

    const existing = byUser.get(event.userId)
    if (existing) {
      existing.count += 1
    } else {
      byUser.set(event.userId, { fullName: event.user.fullName, count: 1, lastAt: event.timestamp })
    }
  }

  return Array.from(byUser.values()).sort((a, b) => b.count - a.count)
}

// KRA/KPI summary matching the leads-list sort-dropdown metrics (Most recently
// active, Highest quotation value, Highest order value, Highest margin, Most
// calls, Most messages) — surfaced on the marketing (individual-scoped) and
// admin (org-wide) dashboards. Same `where` shape the caller already built for
// its own scope, so this stays consistent with whatever ownership filter (or
// lack thereof, for admin) is already in effect.
async function computeSortMetricKpis(where: Prisma.LeadWhereInput, weekStart: Date) {
  const [agg, recentlyActiveCount] = await prisma.$transaction([
    prisma.lead.aggregate({
      where,
      _max: { quotationValue: true, orderValue: true, supplierMargin: true },
      _sum: { totalCalls: true, totalMessages: true },
    }),
    prisma.lead.count({ where: { ...where, lastActivityAt: { gte: weekStart } } }),
  ])

  return {
    recentlyActiveCount,
    highestQuotationValue: agg._max.quotationValue != null ? Number(agg._max.quotationValue) : null,
    highestOrderValue: agg._max.orderValue != null ? Number(agg._max.orderValue) : null,
    highestMargin: agg._max.supplierMargin != null ? Number(agg._max.supplierMargin) : null,
    totalCalls: agg._sum.totalCalls ?? 0,
    totalMessages: agg._sum.totalMessages ?? 0,
  }
}

// GET /api/v1/leads/stats - Aggregate counts for the dashboard metric cards.
// Ownership-filtered like /api/v1/analytics, plus role-specific extras
// consumed by the per-role dashboards under app/(app)/dashboards/.
// Admin may pass ?viewAsUserId=<id> to see stats scoped to another user's role.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const { orgId } = ctx
  const url = new URL(req.url)
  const viewAsUserId = url.searchParams.get('viewAsUserId')

  // Resolve the effective user context: if admin is impersonating, scope to that user
  let userId = ctx.userId
  let role = ctx.role
  let department: string | null = ctx.department

  if (viewAsUserId && ctx.role === 'admin') {
    const viewAsUser = await prisma.user.findFirst({
      where: { id: viewAsUserId, orgId },
      select: { id: true, role: true, department: true },
    })
    if (viewAsUser) {
      userId = viewAsUser.id
      role = viewAsUser.role
      department = viewAsUser.department
    }
  }

  const ownershipFilter = await buildOwnershipFilterAsync(userId, role, department, 'leads')
  const leadsWhere = { orgId, ...ownershipFilter }

  const wonStages = ['Order Confirmed', 'Order Closed', 'Closed Won']

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // $transaction, not Promise.all: these queries used to run concurrently,
  // each reserving its own pool connection. One request already wanted more
  // connections than DATABASE_URL's connection_limit allows, so a handful of
  // concurrent users exhausted the pool entirely (see tests/load/k6-baseline.js).
  // $transaction runs the same queries over a single reserved connection —
  // same query objects, same return shape, just not connection-hungry.
  //
  // groupBy runs as its own call rather than inside the transaction array:
  // Prisma's $transaction([...]) has weaker generic inference than Promise.all
  // for a heterogeneous mix of count/groupBy operations (it loses the _count
  // shape and falls back to a much wider type). Splitting it out costs one
  // extra connection (2 total for this block instead of 1) but keeps everything
  // fully typed with no assertions — a good trade against 7 connections today.
  const byStage = await prisma.lead.groupBy({ by: ['stage'], where: leadsWhere, _count: { _all: true } })
  const [total, slaBreached, open, hot, wonThisMonth, connected] = await prisma.$transaction([
    prisma.lead.count({ where: leadsWhere }),
    prisma.lead.count({ where: { ...leadsWhere, slaBreached: true, status: 'open' } }),
    prisma.lead.count({ where: { ...leadsWhere, status: 'open' } }),
    prisma.lead.count({ where: { ...leadsWhere, status: 'open', priority: { in: ['High', 'Urgent'] } } }),
    prisma.lead.count({
      where: {
        ...leadsWhere,
        stage: { in: wonStages },
        stageChangedAt: { gte: monthStart },
      },
    }),
    prisma.lead.count({
      where: { ...leadsWhere, stage: 'Contacted', contactOutcome: 'connected' },
    }),
  ])

  const byStageMap = Object.fromEntries(byStage.map((s) => [s.stage, s._count._all]))

  const stats: Record<string, unknown> = {
    total,
    open,
    hot,
    wonThisMonth,
    slaBreached,
    byStage: byStageMap,
    // Connected vs Not Received split within Contacted (marketing tabs)
    contactOutcome: {
      connected,
      notReceived: (byStageMap['Contacted'] ?? 0) - connected,
    },
  }

  if (role === 'marketing_manager' || role === 'marketing_executive') {
    stats.contactedCount = byStageMap['Contacted'] ?? 0
    stats.qualifiedCount = byStageMap['Qualified'] ?? 0
    stats.newLeadCount = byStageMap['New Lead'] ?? 0
    stats.kpi = await computeSortMetricKpis(leadsWhere, weekStart)
  }

  if (role === 'sales_manager' || role === 'sales_executive' || role === 'sales_purchase') {
    const activityOwnership = await buildOwnershipFilterAsync(
      userId,
      role,
      department,
      'activities'
    )
    // Split for the same reason as the block above: count + findMany is a
    // heterogeneous pair, and mixing operation types loses type inference
    // inside $transaction's array form. Two connections here, down from two
    // concurrent ones today — no regression, just no longer batched via
    // Promise.all's per-call connection reservation multiplying elsewhere.
    const activitiesThisWeek = await prisma.activity.count({
      where: {
        orgId,
        createdAt: { gte: weekStart },
        ...activityOwnership,
      },
    })
    const openLeadsForAging = await prisma.lead.findMany({
      where: { ...leadsWhere, status: 'open' },
      select: { createdAt: true },
    })

    const now = Date.now()
    const dealAgingBuckets = { '0-7d': 0, '8-30d': 0, '30d+': 0 }
    for (const lead of openLeadsForAging) {
      const ageDays = (now - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays <= 7) dealAgingBuckets['0-7d']++
      else if (ageDays <= 30) dealAgingBuckets['8-30d']++
      else dealAgingBuckets['30d+']++
    }

    stats.activitiesThisWeek = activitiesThisWeek
    stats.dealAgingBuckets = dealAgingBuckets

    const wonCount = (byStageMap['Order Confirmed'] ?? 0) + (byStageMap['Order Closed'] ?? 0)
    const closedCount = wonCount + (byStageMap['Deal Lost'] ?? 0) + (byStageMap['Disqualified'] ?? 0)
    stats.closeRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 1000) / 10 : null

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const [callsToday, messagesToday, overdueFollowUps] = await prisma.$transaction([
      prisma.activity.count({ where: { orgId, type: 'call', createdAt: { gte: todayStart }, ...activityOwnership } }),
      prisma.activity.count({ where: { orgId, type: 'message', createdAt: { gte: todayStart }, ...activityOwnership } }),
      prisma.activity.findMany({
        where: { orgId, status: 'pending', scheduledFor: { lt: new Date() }, ...activityOwnership },
        select: { id: true, leadId: true, title: true, scheduledFor: true, lead: { select: { companyName: true } } },
        orderBy: { scheduledFor: 'asc' },
        take: 20,
      }),
    ])
    stats.callsToday = callsToday
    stats.messagesToday = messagesToday
    stats.overdueFollowUps = overdueFollowUps
  }

  if (role === 'purchase' || role === 'sales_purchase') {
    stats.avgQualifiedToQuoteSentHours = await computeAvgQualifiedToQuoteSentHours(orgId)
  }

  // Admin: recent quotation changes (leads that moved to Quote Sent this week)
  if (role === 'admin') {
    stats.kpi = await computeSortMetricKpis({ orgId }, weekStart)

    const recentQuoteSents = await prisma.lead.findMany({
      where: {
        orgId,
        stage: 'Quote Sent',
        stageChangedAt: { gte: weekStart },
      },
      select: {
        id: true,
        companyName: true,
        quotationNumber: true,
        quotationValue: true,
        supplierMargin: true,
        productCategory: true,
        stageChangedAt: true,
        assignedTo: { select: { fullName: true } },
      },
      orderBy: { stageChangedAt: 'desc' },
      take: 10,
    })
    const maskedFields = await resolveMaskedFields(orgId, userId, role)
    stats.recentQuoteSents = maskedFields.length
      ? recentQuoteSents.map((l) => applyLeadFieldMask(l, maskedFields))
      : recentQuoteSents
    stats.flaggedDisqualifications = await computeFlaggedDisqualifications(orgId)

    const [byClosingHorizon, highMarginLeads, regionalRevenueRows, importExportLogs] = await Promise.all([
      prisma.lead.groupBy({
        by: ['closingHorizon'],
        where: { orgId, closingHorizon: { not: null } },
        _count: { _all: true },
      }),
      prisma.lead.findMany({
        where: { orgId, supplierMargin: { not: null } },
        select: { id: true, companyName: true, supplierMargin: true, assignedTo: { select: { fullName: true } } },
        orderBy: { supplierMargin: 'desc' },
        take: 10,
      }),
      prisma.lead.groupBy({
        by: ['territory'],
        where: { orgId, territory: { not: null }, orderValue: { not: null } },
        _sum: { orderValue: true },
        _count: { _all: true },
      }),
      prisma.auditLog.findMany({
        where: { orgId, action: { in: ['EXPORT', 'IMPORT'] } },
        select: { id: true, action: true, resourceName: true, timestamp: true, user: { select: { fullName: true } } },
        orderBy: { timestamp: 'desc' },
        take: 20,
      }),
    ])

    stats.pipelineByClosingHorizon = Object.fromEntries(
      byClosingHorizon.map((r) => [r.closingHorizon as string, r._count._all])
    )
    stats.highMarginLeads = maskedFields.length
      ? highMarginLeads.map((l) => applyLeadFieldMask(l, maskedFields))
      : highMarginLeads
    stats.regionalRevenue = regionalRevenueRows.map((r) => ({
      territory: r.territory as string,
      totalOrderValue: Number(r._sum.orderValue ?? 0),
      leadCount: r._count._all,
    }))
    stats.recentImportExportActivity = importExportLogs.map((l) => ({
      id: l.id,
      action: l.action,
      resourceName: l.resourceName,
      userFullName: l.user.fullName,
      timestamp: l.timestamp.toISOString(),
    }))
  }

  return successResponse(stats)
})
