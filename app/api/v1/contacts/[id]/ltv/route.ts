import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, NotFoundError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { rbacService } from '@/lib/services/rbac.service'

const ACCEPTED_QUOTE_STATUSES = ['accepted']

interface Params {
  params: { id: string }
}

// GET /api/v1/contacts/:id/ltv - Lifetime value for a contact: sum of
// Quote.finalAmount across accepted/won quotes on this contact's leads.
// Explicitly NOT Lead.orderValue (a per-lead snapshot, not the authoritative
// closed-order amount) — Quote is the source of truth for what was actually
// billed.
export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_READ)

  if (!(await canAccessContact(ctx.userId, ctx.role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({
    where: { id: params.id, orgId: ctx.orgId, deletedAt: null },
    select: { id: true },
  })
  if (!contact) throw new NotFoundError('Contact')

  const quotes = await prisma.quote.findMany({
    where: {
      orgId: ctx.orgId,
      status: { in: ACCEPTED_QUOTE_STATUSES },
      lead: { contactId: contact.id },
    },
    select: { id: true, finalAmount: true, quoteNumber: true, acceptedAt: true },
  })

  const ltv = quotes.reduce((sum, q) => sum + Number(q.finalAmount), 0)

  return successResponse({
    contactId: contact.id,
    ltv,
    acceptedQuoteCount: quotes.length,
    quotes: quotes.map((q) => ({ id: q.id, quoteNumber: q.quoteNumber, finalAmount: Number(q.finalAmount), acceptedAt: q.acceptedAt })),
  })
})
