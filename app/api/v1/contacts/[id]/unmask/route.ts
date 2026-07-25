import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { UnmaskContactFieldSchema } from '@/lib/validation'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { RateLimitError } from '@/lib/errors'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

const UNMASK_LIMIT_PER_HOUR = 50

// POST /api/v1/contacts/:id/unmask - Reveal one masked field. Every reveal is
// logged to PiiViewLog (immutable) and rate-limited per user — counting the
// log itself rather than a separate rate-limit bucket, since the audit trail
// already is the exact record of what should be throttled.
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_READ)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const body = await req.json()
  const parsed = UnmaskContactFieldSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid unmask request', parsed.error.flatten())
  const { field, reason } = parsed.data

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recentUnmasks = await prisma.piiViewLog.count({
    where: { orgId, userId, viewedAt: { gte: oneHourAgo } },
  })
  if (recentUnmasks >= UNMASK_LIMIT_PER_HOUR) {
    throw new RateLimitError(`Unmask limit reached (${UNMASK_LIMIT_PER_HOUR}/hour)`)
  }

  await prisma.piiViewLog.create({
    data: { orgId, userId, contactId: contact.id, fieldUnmasked: field, reason },
  })
  await logAudit(orgId, userId, 'READ', 'Contact', contact.id, `Unmasked ${field}`)

  return successResponse({ field, value: contact[field as 'phone' | 'email' | 'gstNumber'] })
})
