import { prisma } from '@/lib/db'
import { withErrorHandler, getPaginationParams, paginatedResponse, ForbiddenError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

const CUSTOMER_HEALTH_ROLES = ['admin', 'sales_manager']

// GET /api/v1/customers — org-scoped list from the pre-existing ERP Customer
// table (see prisma/schema.prisma note above the model). Only fields that
// actually exist on the table are returned — no fabricated revenue/outstanding
// figures until Invoice/Outstanding are reconnected to this schema.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  if (!CUSTOMER_HEALTH_ROLES.includes(ctx.role)) throw new ForbiddenError('Customer health is restricted to admin and sales managers')
  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)

  const where = { orgId: ctx.orgId, active: true }
  const [items, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { creditLimit: 'desc' }, skip, take: limit }),
    prisma.customer.count({ where }),
  ])

  return paginatedResponse(items, { page, limit, total, totalPages: Math.ceil(total / limit) })
})
