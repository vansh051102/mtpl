import { prisma } from './db'

const AGED_QUOTE_SENT_DAYS = 4
const SLA_STREAK_WINDOW_DAYS = 7
const SLA_STREAK_THRESHOLD = 3
// Same dedupe window as lib/anomaly-detection.ts — a cron running every few
// minutes shouldn't spam the queue with near-duplicate flags for one ongoing issue.
const DEDUPE_WINDOW_MS = 60 * 60 * 1000

const HEALTH_DEPARTMENTS = ['Sales', 'Marketing', 'Purchase'] as const

async function alreadyFlaggedRecently(
  orgId: string,
  userId: string,
  flagType: string,
  entityId?: string
): Promise<boolean> {
  const existing = await prisma.anomalyFlag.findFirst({
    where: {
      orgId,
      userId,
      flagType,
      ...(entityId ? { entityId } : {}),
      resolvedAt: null,
      flaggedAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  })
  return Boolean(existing)
}

/** 3+ breached/overdue SlaClocks for the same assignee within 7 days -> HIGH alert. */
export async function detectSlaBreachStreaks(): Promise<number> {
  const since = new Date(Date.now() - SLA_STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const clocks = await prisma.slaClock.findMany({
    where: {
      entityType: 'Lead',
      status: { in: ['breached', 'overdue'] },
      startedAt: { gte: since },
    },
    select: { orgId: true, entityId: true },
  })
  if (clocks.length === 0) return 0

  const leadIds = [...new Set(clocks.map((c) => c.entityId))]
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, assignedToId: true },
  })
  const assigneeByLead = new Map(leads.map((l) => [l.id, l.assignedToId]))

  const breachCountByAssignee = new Map<string, { orgId: string; count: number }>()
  for (const clock of clocks) {
    const assignedToId = assigneeByLead.get(clock.entityId)
    if (!assignedToId) continue
    const key = assignedToId
    const entry = breachCountByAssignee.get(key)
    if (entry) entry.count++
    else breachCountByAssignee.set(key, { orgId: clock.orgId, count: 1 })
  }

  let flagged = 0
  for (const [userId, { orgId, count }] of breachCountByAssignee) {
    if (count < SLA_STREAK_THRESHOLD) continue
    if (await alreadyFlaggedRecently(orgId, userId, 'SLA_BREACH_STREAK')) continue

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
    await prisma.anomalyFlag.create({
      data: {
        orgId,
        userId,
        entityType: 'Lead',
        flagType: 'SLA_BREACH_STREAK',
        severity: 'HIGH',
        description: `${user?.fullName ?? 'This rep'} has ${count} SLA-breached leads in the last ${SLA_STREAK_WINDOW_DAYS} days`,
      },
    })
    flagged++
  }
  return flagged
}

/** Leads sitting in "Quote Sent" for more than AGED_QUOTE_SENT_DAYS -> MEDIUM alert. */
export async function detectAgedQuoteSentLeads(): Promise<number> {
  const cutoff = new Date(Date.now() - AGED_QUOTE_SENT_DAYS * 24 * 60 * 60 * 1000)

  const agedLeads = await prisma.lead.findMany({
    where: { stage: 'Quote Sent', stageChangedAt: { lte: cutoff }, isArchived: false },
    select: { id: true, orgId: true, companyName: true, assignedToId: true, createdById: true, stageChangedAt: true },
  })

  let flagged = 0
  for (const lead of agedLeads) {
    const userId = lead.assignedToId ?? lead.createdById
    if (await alreadyFlaggedRecently(lead.orgId, userId, 'AGED_QUOTE_SENT', lead.id)) continue

    const days = Math.floor((Date.now() - lead.stageChangedAt.getTime()) / (24 * 60 * 60 * 1000))
    await prisma.anomalyFlag.create({
      data: {
        orgId: lead.orgId,
        userId,
        entityType: 'Lead',
        entityId: lead.id,
        flagType: 'AGED_QUOTE_SENT',
        severity: 'MEDIUM',
        description: `${lead.companyName} has been in Quote Sent for ${days} days`,
      },
    })
    flagged++
  }
  return flagged
}

export async function runCommandCenterAlertScan(): Promise<{ slaStreaks: number; agedQuotes: number }> {
  const [slaStreaks, agedQuotes] = await Promise.all([detectSlaBreachStreaks(), detectAgedQuoteSentLeads()])
  return { slaStreaks, agedQuotes }
}

// ============================================================================
// DEPARTMENT HEALTH SCORING
// ============================================================================

export function healthFromScore(score: number): 'GREEN' | 'YELLOW' | 'RED' {
  if (score >= 80) return 'GREEN'
  if (score >= 50) return 'YELLOW'
  return 'RED'
}

interface DepartmentMetrics extends Record<string, number> {
  openLeads: number
  slaBreachedPct: number
  agedQuoteSentCount: number
  conversionPct: number
}

async function scoreSalesOrMarketing(
  orgId: string,
  department: 'Sales' | 'Marketing'
): Promise<{ score: number; metrics: DepartmentMetrics }> {
  const assignees = await prisma.user.findMany({ where: { orgId, department }, select: { id: true } })
  const assigneeIds = assignees.map((u) => u.id)

  const leadWhere = assigneeIds.length > 0 ? { orgId, assignedToId: { in: assigneeIds }, isArchived: false } : { orgId, isArchived: false, id: 'none' }

  const [openLeads, breachedLeads, agedQuoteSentCount, totalTerminal, wonLeads] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, status: 'open' } }),
    prisma.lead.count({ where: { ...leadWhere, slaBreached: true, status: 'open' } }),
    prisma.lead.count({
      where: { ...leadWhere, stage: 'Quote Sent', stageChangedAt: { lte: new Date(Date.now() - AGED_QUOTE_SENT_DAYS * 24 * 60 * 60 * 1000) } },
    }),
    prisma.lead.count({ where: { ...leadWhere, stage: { in: ['Order Confirmed', 'Order Closed', 'Deal Lost', 'Disqualified', 'Closed Won'] } } }),
    prisma.lead.count({ where: { ...leadWhere, stage: { in: ['Order Confirmed', 'Order Closed', 'Closed Won'] } } }),
  ])

  const slaBreachedPct = openLeads > 0 ? Math.round((breachedLeads / openLeads) * 100) : 0
  const conversionPct = totalTerminal > 0 ? Math.round((wonLeads / totalTerminal) * 100) : 0

  // Composite: start from 100, dock for SLA breaches and aging, credit conversion.
  let score = 100 - slaBreachedPct * 0.8 - Math.min(agedQuoteSentCount, 10) * 3
  if (totalTerminal >= 5) score = score * 0.7 + conversionPct * 0.3
  score = Math.max(0, Math.min(100, score))

  return { score, metrics: { openLeads, slaBreachedPct, agedQuoteSentCount, conversionPct } }
}

async function scorePurchase(orgId: string): Promise<{ score: number; metrics: Record<string, number> }> {
  const [pending, total] = await Promise.all([
    prisma.purchaseRequest.count({ where: { orgId, status: 'pending' } }),
    prisma.purchaseRequest.count({ where: { orgId } }),
  ])
  const pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0
  const score = Math.max(0, 100 - pendingPct)
  return { score, metrics: { pending, total, pendingPct } }
}

export async function computeDepartmentHealth(orgId: string): Promise<void> {
  const results: Array<{ department: string; score: number; metrics: Record<string, unknown> }> = []

  for (const department of ['Sales', 'Marketing'] as const) {
    const { score, metrics } = await scoreSalesOrMarketing(orgId, department)
    results.push({ department, score, metrics })
  }
  const { score: purchaseScore, metrics: purchaseMetrics } = await scorePurchase(orgId)
  results.push({ department: 'Purchase', score: purchaseScore, metrics: purchaseMetrics })

  await Promise.all(
    results.map((r) =>
      prisma.departmentHealthSnapshot.create({
        data: {
          orgId,
          department: r.department,
          health: healthFromScore(r.score),
          score: r.score,
          metricsJson: r.metrics as object,
        },
      })
    )
  )

  const managementScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
  await prisma.departmentHealthSnapshot.create({
    data: {
      orgId,
      department: 'Management',
      health: healthFromScore(managementScore),
      score: managementScore,
      metricsJson: { componentScores: Object.fromEntries(results.map((r) => [r.department, r.score])) },
    },
  })
}

/** One row per department, most recent calculatedAt. */
export async function getLatestDepartmentHealth(orgId: string) {
  const departments = [...HEALTH_DEPARTMENTS, 'Management']
  const rows = await Promise.all(
    departments.map((department) =>
      prisma.departmentHealthSnapshot.findFirst({
        where: { orgId, department },
        orderBy: { calculatedAt: 'desc' },
      })
    )
  )
  return rows.filter((r): r is NonNullable<typeof r> => r !== null)
}
