import { prisma } from './db'

// Fields marked `null` below aren't backed by any existing model/column yet
// (no Call log, no per-order cost-savings figure) — render as "—" in the UI
// rather than fabricate a number. See docs/ENGINEERING_PRINCIPLES.md: every
// metric must be traceable to a real query.

export interface SalesScorecard {
  revenue: number
  targetPct: number | null
  orders: number
  quotesSent: number
  quotesPending: number
  followUpsDue: number
  callsMade: null
  winRate: number
  avgResponseTimeHours: number | null
  slaPct: number
  kraScore: number | null
}

export interface LeadGenScorecard {
  newLeads: number
  calls: null
  connectionRate: null
  qualified: number
  disqualified: number
  leadToSalesPct: number
  firstCallSlaPct: number
  avgCallTime: null
  kraScore: number | null
}

export interface PurchaseScorecard {
  rfqs: number
  pendingRfqs: number
  supplierReplies: null
  purchaseOrders: number
  delayedSuppliers: null
  costSavings: null
  slaPct: number
  kraScore: number | null
}

function monthStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

async function departmentKra(orgId: string, department: string): Promise<number | null> {
  const bucket = new Date().toISOString().split('T')[0]
  const users = await prisma.user.findMany({ where: { orgId, department, status: 'active' }, select: { id: true } })
  if (users.length === 0) return null
  const snapshots = await prisma.kpiSnapshot.findMany({
    where: { orgId, scopeType: 'user', scopeId: { in: users.map((u) => u.id) }, bucket, bucketType: 'day' },
    select: { value: true },
  })
  if (snapshots.length === 0) return null
  return snapshots.reduce((sum, s) => sum + Number(s.value), 0) / snapshots.length
}

async function slaPctForLeads(orgId: string, assignedToIds: string[]): Promise<number> {
  if (assignedToIds.length === 0) return 100
  const leads = await prisma.lead.findMany({ where: { orgId, assignedToId: { in: assignedToIds } }, select: { id: true } })
  if (leads.length === 0) return 100
  const clocks = await prisma.slaClock.findMany({
    where: { orgId, entityType: 'Lead', entityId: { in: leads.map((l) => l.id) } },
    select: { status: true },
  })
  if (clocks.length === 0) return 100
  const breached = clocks.filter((c) => c.status === 'breached' || c.status === 'overdue').length
  return Math.max(0, 100 - (breached / clocks.length) * 100)
}

export async function getSalesScorecard(orgId: string): Promise<SalesScorecard> {
  const since = monthStart()
  const salesUsers = await prisma.user.findMany({ where: { orgId, department: 'Sales' }, select: { id: true } })
  const assignedToIds = salesUsers.map((u) => u.id)

  const [wonLeads, orders, quotesSent, quotesPending, followUpsDue, totalTerminal, target, kraScore, slaPct] = await Promise.all([
    prisma.lead.findMany({
      where: { orgId, stage: { in: ['Order Confirmed', 'Order Closed', 'Closed Won'] }, stageChangedAt: { gte: since } },
      select: { orderValue: true },
    }),
    prisma.lead.count({ where: { orgId, stage: { in: ['Order Confirmed', 'Order Closed', 'Closed Won'] }, stageChangedAt: { gte: since } } }),
    prisma.quote.count({ where: { orgId, deletedAt: null, sentAt: { gte: since } } }),
    prisma.quote.count({ where: { orgId, deletedAt: null, status: { notIn: ['accepted', 'rejected'] }, sentAt: { not: null } } }),
    prisma.lead.count({ where: { orgId, status: 'open', slaDeadline: { lte: new Date() } } }),
    prisma.lead.count({ where: { orgId, stage: { in: ['Order Confirmed', 'Order Closed', 'Deal Lost', 'Disqualified', 'Closed Won'] }, stageChangedAt: { gte: since } } }),
    prisma.target.findFirst({ where: { orgId, department: 'Sales', metric: 'revenue', period: 'MONTH', periodStart: since } }),
    departmentKra(orgId, 'Sales'),
    slaPctForLeads(orgId, assignedToIds),
  ])

  const revenue = wonLeads.reduce((sum, l) => sum + Number(l.orderValue ?? 0), 0)
  const winRate = totalTerminal > 0 ? Math.round((orders / totalTerminal) * 100) : 0
  const targetPct = target ? Math.round((revenue / Number(target.targetValue)) * 100) : null

  return { revenue, targetPct, orders, quotesSent, quotesPending, followUpsDue, callsMade: null, winRate, avgResponseTimeHours: null, slaPct, kraScore }
}

export async function getLeadGenScorecard(orgId: string): Promise<LeadGenScorecard> {
  const since = monthStart()
  const leadGenUsers = await prisma.user.findMany({ where: { orgId, department: 'Marketing' }, select: { id: true } })
  const assignedToIds = leadGenUsers.map((u) => u.id)

  const [newLeads, qualified, disqualified, wonFromLeadGen, totalFromLeadGen, kraScore, slaPct] = await Promise.all([
    prisma.lead.count({ where: { orgId, createdAt: { gte: since } } }),
    prisma.lead.count({ where: { orgId, qualifiedAt: { gte: since } } }),
    prisma.lead.count({ where: { orgId, stage: 'Disqualified', stageChangedAt: { gte: since } } }),
    prisma.lead.count({ where: { orgId, stage: { in: ['Order Confirmed', 'Order Closed', 'Closed Won'] }, createdAt: { gte: since } } }),
    prisma.lead.count({ where: { orgId, createdAt: { gte: since } } }),
    departmentKra(orgId, 'Marketing'),
    slaPctForLeads(orgId, assignedToIds),
  ])

  const leadToSalesPct = totalFromLeadGen > 0 ? Math.round((wonFromLeadGen / totalFromLeadGen) * 100) : 0

  return {
    newLeads,
    calls: null,
    connectionRate: null,
    qualified,
    disqualified,
    leadToSalesPct,
    firstCallSlaPct: slaPct,
    avgCallTime: null,
    kraScore,
  }
}

export async function getPurchaseScorecard(orgId: string): Promise<PurchaseScorecard> {
  const since = monthStart()

  const [rfqs, pendingRfqs, purchaseOrders, kraScore] = await Promise.all([
    prisma.purchaseRequest.count({ where: { orgId, createdAt: { gte: since } } }),
    prisma.purchaseRequest.count({ where: { orgId, status: 'pending' } }),
    prisma.purchaseRequest.count({ where: { orgId, status: { not: 'pending' }, createdAt: { gte: since } } }),
    departmentKra(orgId, 'Purchase'),
  ])

  const total = await prisma.purchaseRequest.count({ where: { orgId } })
  const slaPct = total > 0 ? Math.max(0, 100 - (pendingRfqs / total) * 100) : 100

  return {
    rfqs,
    pendingRfqs,
    supplierReplies: null,
    purchaseOrders,
    delayedSuppliers: null,
    costSavings: null,
    slaPct,
    kraScore,
  }
}
