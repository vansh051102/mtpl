import { prisma } from './db'
import { getLatestDepartmentHealth } from './command-center-engine'

// Documented weights (see docs/MTPL_OS_DESIGN_SYSTEM.md §Business Health Formula).
// Sales + Marketing (lead gen) + Purchase come from DepartmentHealthSnapshot;
// People from org-wide KpiSnapshot average; SLA from open-lead SlaClock breach rate.
export const SALES_WEIGHT = 0.35
export const LEADGEN_WEIGHT = 0.25
export const PURCHASE_WEIGHT = 0.2
export const PEOPLE_WEIGHT = 0.1
export const SLA_WEIGHT = 0.1

function todayBucket(): string {
  return new Date().toISOString().split('T')[0]
}

async function peopleScore(orgId: string): Promise<number> {
  const snapshots = await prisma.kpiSnapshot.findMany({
    where: { orgId, scopeType: 'user', bucket: todayBucket(), bucketType: 'day' },
    select: { value: true },
  })
  if (snapshots.length === 0) return 0
  const sum = snapshots.reduce((acc, s) => acc + Number(s.value), 0)
  return Math.max(0, Math.min(100, sum / snapshots.length))
}

async function slaScore(orgId: string): Promise<number> {
  const clocks = await prisma.slaClock.findMany({
    where: { orgId, entityType: 'Lead' },
    select: { status: true },
  })
  if (clocks.length === 0) return 100
  const breached = clocks.filter((c) => c.status === 'breached' || c.status === 'overdue').length
  return Math.max(0, 100 - (breached / clocks.length) * 100)
}

export interface BusinessHealth {
  overallScore: number
  sales: number
  leadGen: number
  purchase: number
  people: number
  sla: number
}

/** Weighted composite health score per the documented formula. Missing department
 * snapshots (no cron run yet) score 0 for that term rather than throwing. */
export async function computeOverallHealth(orgId: string): Promise<BusinessHealth> {
  const [snapshots, people, sla] = await Promise.all([
    getLatestDepartmentHealth(orgId),
    peopleScore(orgId),
    slaScore(orgId),
  ])
  const scoreFor = (department: string) => Number(snapshots.find((s) => s.department === department)?.score ?? 0)
  const sales = scoreFor('Sales')
  const leadGen = scoreFor('Marketing')
  const purchase = scoreFor('Purchase')

  const overallScore =
    sales * SALES_WEIGHT + leadGen * LEADGEN_WEIGHT + purchase * PURCHASE_WEIGHT + people * PEOPLE_WEIGHT + sla * SLA_WEIGHT

  return { overallScore, sales, leadGen, purchase, people, sla }
}
