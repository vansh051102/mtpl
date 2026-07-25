import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { DisqualifyContactSchema } from '@/lib/validation'
import { assertContactTransitionAllowed, assertContactVersion } from '@/lib/contact-workflow'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { resolveMaskedFields, applyContactFieldMask } from '@/lib/contact-serializer'

interface Params {
  params: { id: string }
}

// POST /api/v1/contacts/:id/disqualify - Close out a Contact before it ever
// became a Lead (product out of scope, unresponsive, etc). Distinct from
// soft-delete: a disqualified contact is a legitimate, worth-keeping record
// of a closed inquiry; soft-delete is for entries that shouldn't exist at all.
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_EDIT)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const body = await req.json()
  const parsed = DisqualifyContactSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid disqualify data', parsed.error.flatten())
  const { reason, details, expectedVersion } = parsed.data

  assertContactVersion(contact, expectedVersion)
  assertContactTransitionAllowed(contact.stage, 'Disqualified')

  const [updated] = await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: {
        stage: 'Disqualified',
        disqualifiedReason: reason,
        disqualifiedDetails: details,
        version: { increment: 1 },
      },
    }),
    prisma.activity.create({
      data: {
        orgId,
        contactId: contact.id,
        type: 'stage_change',
        title: `Disqualified: ${reason}`,
        description: details,
        status: 'completed',
        completedAt: new Date(),
        metadata: { fromStage: contact.stage, toStage: 'Disqualified', reason },
        createdBy: userId,
      },
    }),
  ])

  await logAudit(orgId, userId, 'UPDATE', 'Contact', updated.id, `Disqualified: ${reason}`, { reason, details })

  const maskedFields = await resolveMaskedFields(orgId, userId, role || 'admin')
  return successResponse(maskedFields.length ? applyContactFieldMask(updated, maskedFields) : updated)
})
