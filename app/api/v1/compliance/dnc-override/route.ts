import { z } from 'zod'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

const DncOverrideSchema = z.object({
  contactId: z.string().min(1),
  overrideReason: z.string().min(10, 'Explain the manual verification performed (min 10 characters)'),
  approvalTicketId: z.string().min(1),
})

// POST /api/v1/compliance/dnc-override - Clear a Do-Not-Call flag after
// manual verification. No compliance_officer role exists in this app today,
// so this is gated to admin (SETTINGS_EDIT, the same admin-only permission
// the Integrations/compliance-adjacent settings pages already use) rather
// than inventing a new role/permission for a single action.
export const POST = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.SETTINGS_EDIT)

  const body = await req.json()
  const parsed = DncOverrideSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid override request', parsed.error.flatten())
  const { contactId, overrideReason, approvalTicketId } = parsed.data

  const contact = await prisma.contact.findFirst({ where: { id: contactId, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const updated = await prisma.contact.update({
    where: { id: contactId },
    data: { isDncListed: false, dncStatus: 'CLEARED', version: { increment: 1 } },
  })

  await logAudit(orgId, userId, 'UPDATE', 'Contact', contactId, 'DNC override', {
    overrideReason,
    approvalTicketId,
  })

  return successResponse(updated)
})
