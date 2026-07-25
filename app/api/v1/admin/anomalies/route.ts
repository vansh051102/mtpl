import { prisma } from '@/lib/db'
import { paginatedResponse, withErrorHandler, getPaginationParams } from '@/lib/api-response'
import { PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

// GET /api/v1/admin/anomalies - Manager review queue for anti-gaming flags
// (Gap 22). Unresolved first, gated to admin (SETTINGS_EDIT) — same gate as
// the DNC override, no dedicated role exists for this yet.
export const GET = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.SETTINGS_EDIT)

  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)
  const unresolvedOnly = url.searchParams.get('resolved') !== 'true'
  const severity = url.searchParams.get('severity')

  const where = {
    orgId,
    ...(unresolvedOnly ? { resolvedAt: null } : {}),
    ...(severity ? { severity } : {}),
  }

  const [flags, total] = await Promise.all([
    prisma.anomalyFlag.findMany({
      where,
      orderBy: [{ resolvedAt: 'asc' as const }, { flaggedAt: 'desc' as const }],
      skip,
      take: limit,
    }),
    prisma.anomalyFlag.count({ where }),
  ])

  const userIds = [...new Set(flags.map((f) => f.userId))]
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
  const nameById = new Map(users.map((u) => [u.id, u.fullName]))

  const enriched = flags.map((f) => ({ ...f, userName: nameById.get(f.userId) ?? f.userId }))

  return paginatedResponse(enriched, { page, limit, total, totalPages: Math.ceil(total / limit) })
})
