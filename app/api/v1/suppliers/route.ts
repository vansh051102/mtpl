import { prisma } from '@/lib/db'
import { withErrorHandler, getPaginationParams, paginatedResponse, ForbiddenError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

const SUPPLIER_HEALTH_ROLES = ['admin', 'purchase', 'sales_purchase']

// GET /api/v1/suppliers — org-scoped list from the pre-existing ERP Supplier
// table. Only real columns (rating, paymentTerms) — delivery%/response-time
// need PurchaseOrder reconnected to this schema, not fabricated here.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  if (!SUPPLIER_HEALTH_ROLES.includes(ctx.role)) throw new ForbiddenError('Supplier health is restricted to admin and purchase roles')
  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)

  const where = { orgId: ctx.orgId, active: true }
  const [items, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { rating: 'desc' }, skip, take: limit }),
    prisma.supplier.count({ where }),
  ])

  return paginatedResponse(items, { page, limit, total, totalPages: Math.ceil(total / limit) })
})
