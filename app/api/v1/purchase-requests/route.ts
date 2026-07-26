import { prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/rbac'
import { withErrorHandler, getPaginationParams, paginatedResponse } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

// GET /api/v1/purchase-requests — org-scoped list, optional ?status= filter.
// Backs the /purchase nav page (MTPL OS nav freeze).
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.PURCHASE_REQUESTS_READ)

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const { page, limit, skip } = getPaginationParams(url.searchParams)

  const where = { orgId: ctx.orgId, ...(status ? { status } : {}) }

  const [items, total] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { lead: { select: { id: true, companyName: true } } },
    }),
    prisma.purchaseRequest.count({ where }),
  ])

  return paginatedResponse(items, { page, limit, total, totalPages: Math.ceil(total / limit) })
})
