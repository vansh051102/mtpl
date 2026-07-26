import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequestWithRole } from '@/lib/middleware/validate-headers'

const ONLINE_STALE_MS = 15 * 60 * 1000
const MATRIX_ROLES = ['admin', 'sales_manager', 'marketing_manager']

function todayBucket(): string {
  return new Date().toISOString().split('T')[0]
}

// GET /api/v1/command-center/employee-matrix — roster with live presence, KRA
// score (from KpiSnapshot), and SLA % (from SlaClock via assigned leads).
// admin sees the whole org (optionally filtered by ?department=); managers
// only see their own department's roster.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequestWithRole(req, MATRIX_ROLES)

  const url = new URL(req.url)
  const requestedDepartment = url.searchParams.get('department')
  const department = ctx.role === 'admin' ? requestedDepartment : ctx.department

  const users = await prisma.user.findMany({
    where: {
      orgId: ctx.orgId,
      status: 'active',
      ...(department ? { department } : {}),
    },
    select: {
      id: true,
      fullName: true,
      department: true,
      designation: true,
      role: true,
      liveAvailability: true,
      lastLogin: true,
    },
    orderBy: { fullName: 'asc' },
  })
  if (users.length === 0) return successResponse([])

  const userIds = users.map((u) => u.id)
  const bucket = todayBucket()

  const [kpiSnapshots, assignedLeads] = await Promise.all([
    prisma.kpiSnapshot.findMany({
      where: { orgId: ctx.orgId, scopeType: 'user', scopeId: { in: userIds }, bucket, bucketType: 'day' },
      select: { scopeId: true, value: true },
    }),
    prisma.lead.findMany({
      where: { orgId: ctx.orgId, assignedToId: { in: userIds } },
      select: { id: true, assignedToId: true },
    }),
  ])

  const leadIdsByUser = new Map<string, string[]>()
  for (const lead of assignedLeads) {
    if (!lead.assignedToId) continue
    const list = leadIdsByUser.get(lead.assignedToId) ?? []
    list.push(lead.id)
    leadIdsByUser.set(lead.assignedToId, list)
  }
  const allLeadIds = assignedLeads.map((l) => l.id)
  const slaClocks =
    allLeadIds.length > 0
      ? await prisma.slaClock.findMany({
          where: { orgId: ctx.orgId, entityType: 'Lead', entityId: { in: allLeadIds } },
          select: { entityId: true, status: true },
        })
      : []
  const clocksByLead = new Map<string, { total: number; breached: number }>()
  for (const clock of slaClocks) {
    const entry = clocksByLead.get(clock.entityId) ?? { total: 0, breached: 0 }
    entry.total++
    if (clock.status === 'breached' || clock.status === 'overdue') entry.breached++
    clocksByLead.set(clock.entityId, entry)
  }

  const kraByUser = new Map<string, number[]>()
  for (const snap of kpiSnapshots) {
    const list = kraByUser.get(snap.scopeId) ?? []
    list.push(Number(snap.value))
    kraByUser.set(snap.scopeId, list)
  }

  const matrix = users.map((u) => {
    const leadIds = leadIdsByUser.get(u.id) ?? []
    let total = 0
    let breached = 0
    for (const leadId of leadIds) {
      const c = clocksByLead.get(leadId)
      if (!c) continue
      total += c.total
      breached += c.breached
    }
    const kraValues = kraByUser.get(u.id)
    const kraScore = kraValues && kraValues.length > 0 ? kraValues.reduce((a, b) => a + b, 0) / kraValues.length : null

    return {
      id: u.id,
      fullName: u.fullName,
      department: u.department,
      designation: u.designation,
      role: u.role,
      liveAvailability:
        u.liveAvailability === 'ONLINE' && u.lastLogin && Date.now() - u.lastLogin.getTime() < ONLINE_STALE_MS
          ? 'ONLINE'
          : 'OFFLINE',
      kraScore,
      slaPct: total > 0 ? Math.round(((total - breached) / total) * 100) : null,
    }
  })

  return successResponse(matrix)
})
