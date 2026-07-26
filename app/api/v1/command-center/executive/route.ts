import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequestWithRole } from '@/lib/middleware/validate-headers'
import { getLatestDepartmentHealth } from '@/lib/command-center-engine'

const ONLINE_STALE_MS = 15 * 60 * 1000

// GET /api/v1/command-center/executive — admin-only header-bar + department
// traffic-light data for the CEO Command Center (/dashboards/executive).
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequestWithRole(req, ['admin'])

  const [totalCount, onlineUsers, topAlerts, departments] = await Promise.all([
    prisma.user.count({ where: { orgId: ctx.orgId, status: 'active' } }),
    prisma.user.findMany({
      where: { orgId: ctx.orgId, status: 'active', liveAvailability: 'ONLINE' },
      select: { lastLogin: true },
    }),
    prisma.anomalyFlag.findMany({
      where: { orgId: ctx.orgId, resolvedAt: null },
      orderBy: [{ severity: 'desc' }, { flaggedAt: 'desc' }],
      take: 10,
    }),
    getLatestDepartmentHealth(ctx.orgId),
  ])

  const presentCount = onlineUsers.filter(
    (u) => u.lastLogin && Date.now() - u.lastLogin.getTime() < ONLINE_STALE_MS
  ).length

  return successResponse({
    now: new Date().toISOString(),
    presentCount,
    totalCount,
    topAlerts,
    departments,
  })
})
