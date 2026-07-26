import { prisma } from './db'

const QUOTE_OVERDUE_HOURS = 24
const OPEN_QUOTE_STATUSES_EXCLUDED = ['accepted', 'rejected']

export type PrioritySeverity = 'RED' | 'ORANGE' | 'GREEN'

export interface Priority {
  severity: PrioritySeverity
  message: string
  actionUrl: string
}

async function overdueQuotes(orgId: string): Promise<Priority | null> {
  const cutoff = new Date(Date.now() - QUOTE_OVERDUE_HOURS * 60 * 60 * 1000)
  const count = await prisma.quote.count({
    where: {
      orgId,
      deletedAt: null,
      sentAt: { not: null, lte: cutoff },
      status: { notIn: OPEN_QUOTE_STATUSES_EXCLUDED },
    },
  })
  if (count === 0) return null
  return {
    severity: 'RED',
    message: `${count} quotation${count > 1 ? 's' : ''} pending > ${QUOTE_OVERDUE_HOURS} hours`,
    actionUrl: `/leads?stage=Quote+Sent`,
  }
}

async function uncontactedLeads(orgId: string): Promise<Priority | null> {
  const count = await prisma.lead.count({
    where: { orgId, isArchived: false, status: 'open', firstResponseAt: null, slaBreached: true },
  })
  if (count === 0) return null
  return {
    severity: 'ORANGE',
    message: `${count} qualified lead${count > 1 ? 's' : ''} not contacted`,
    actionUrl: `/leads?slaBreached=true`,
  }
}

async function pendingRfqApprovals(orgId: string): Promise<Priority | null> {
  const pending = await prisma.purchaseRequest.findMany({
    where: { orgId, status: 'pending' },
    select: { prNumber: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
  })
  const count = await prisma.purchaseRequest.count({ where: { orgId, status: 'pending' } })
  if (count === 0) return null
  const label = count === 1 ? `Purchase RFQ #${pending[0].prNumber} awaiting approval` : `${count} purchase RFQs awaiting approval`
  return { severity: 'RED', message: label, actionUrl: `/purchase?status=pending` }
}

async function salesTargetPace(orgId: string): Promise<Priority | null> {
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const target = await prisma.target.findFirst({
    where: { orgId, department: 'Sales', metric: 'revenue', period: 'MONTH', periodStart },
  })
  // ponytail: no Target row yet (owner hasn't set goals) — silently skip rather than fabricate a number.
  if (!target) return null

  const wonLeads = await prisma.lead.findMany({
    where: { orgId, stage: { in: ['Order Confirmed', 'Order Closed', 'Closed Won'] }, stageChangedAt: { gte: periodStart } },
    select: { orderValue: true },
  })
  const achieved = wonLeads.reduce((sum, l) => sum + Number(l.orderValue ?? 0), 0)
  const pct = Math.round((achieved / Number(target.targetValue)) * 100)
  const dayOfMonth = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100)

  return {
    severity: pct >= expectedPct ? 'GREEN' : 'ORANGE',
    message: `Sales target at ${pct}% (expected ${expectedPct}% by today)`,
    actionUrl: `/analytics?department=Sales`,
  }
}

/** Pure rules engine, no AI — every priority is derived from live data. */
export async function getExecutivePriorities(orgId: string): Promise<Priority[]> {
  const results = await Promise.all([overdueQuotes(orgId), uncontactedLeads(orgId), pendingRfqApprovals(orgId), salesTargetPace(orgId)])
  const severityOrder: Record<PrioritySeverity, number> = { RED: 0, ORANGE: 1, GREEN: 2 }
  return results.filter((p): p is Priority => p !== null).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}
