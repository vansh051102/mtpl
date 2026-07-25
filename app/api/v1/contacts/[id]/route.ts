import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { UpdateContactSchema } from '@/lib/validation'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { resolveMaskedFields, applyContactFieldMask } from '@/lib/contact-serializer'
import { logContactFieldDiffs } from '@/lib/field-diff'

interface Params {
  params: { id: string }
}

// GET /api/v1/contacts/:id
export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_READ)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({
    where: { id: params.id, orgId, deletedAt: null },
    include: {
      leads: {
        select: {
          id: true,
          companyName: true,
          stage: true,
          createdAt: true,
          timeline: {
            select: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
          },
        },
      },
    },
  })
  if (!contact) throw new NotFoundError('Contact')

  const maskedFields = await resolveMaskedFields(orgId, userId, role || 'admin')
  return successResponse(maskedFields.length ? applyContactFieldMask(contact, maskedFields) : contact)
})

// PUT /api/v1/contacts/:id
export const PUT = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_EDIT)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const existing = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!existing) throw new NotFoundError('Contact')

  const body = await req.json()
  const parsed = UpdateContactSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid contact data', parsed.error.flatten())
  }

  await logContactFieldDiffs(orgId, existing.id, userId, existing, parsed.data)

  const contact = await prisma.contact.update({
    where: { id: params.id },
    data: parsed.data,
  })

  await logAudit(orgId, userId, 'UPDATE', 'Contact', contact.id, `${contact.firstName} ${contact.lastName}`, parsed.data)

  const maskedFields = await resolveMaskedFields(orgId, userId, role || 'admin')
  return successResponse(maskedFields.length ? applyContactFieldMask(contact, maskedFields) : contact)
})

// DELETE /api/v1/contacts/:id - Soft delete only. Preserves the row (and its
// activity history) for audit while freeing the phone/email for legitimate
// reuse via the partial unique indexes (see migration 20260726000000).
export const DELETE = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_EDIT)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const existing = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!existing) throw new NotFoundError('Contact')

  const contact = await prisma.contact.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), deletedByUserId: userId },
  })

  await logAudit(orgId, userId, 'DELETE', 'Contact', contact.id, `${contact.firstName} ${contact.lastName}`)

  return successResponse({ id: contact.id, deleted: true })
})
