import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, NotFoundError, ValidationError, ConflictError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { z } from 'zod'

interface Params {
  params: { id: string }
}

const AssignToSalesSchema = z.object({
  assignedToId: z.string().min(1),
  companyName: z.string().min(1),
  handoffNotes: z.string().min(10, 'Handoff notes must describe the requirement/urgency (min 10 characters)'),
})

// POST /api/v1/contacts/:id/assign-to-sales
// Marketing/telecaller hands a contact off to a salesperson: creates a Lead
// linked to this contact (contact itself is untouched — it stays visible in
// Contacts, now shown as "Assigned to <salesperson>"). Lead.source is the
// acting user's name, not the contact's original import source.
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.CONTACTS_EDIT)
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.LEADS_CREATE)

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const body = await req.json()
  const parsed = AssignToSalesSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid request', parsed.error.flatten())
  }

  const salesperson = await prisma.user.findFirst({
    where: { id: parsed.data.assignedToId, orgId, status: 'active' },
  })
  if (!salesperson) throw new NotFoundError('Salesperson')

  // Validation gate: don't let a handoff through without at least one
  // Connected call — otherwise Sales gets a lead nobody actually spoke to.
  const hasConnectedCall = await prisma.activity.findFirst({
    where: { contactId: contact.id, type: 'call', metadata: { path: ['outcome'], equals: 'Connected' } },
    select: { id: true },
  })
  if (!hasConnectedCall) {
    throw new ValidationError('Log at least one Connected call with this contact before assigning to sales')
  }

  const assigner = await prisma.user.findUnique({ where: { id: userId } })

  const result = await createLeadWithDefaults({
    orgId,
    contactId: contact.id,
    companyName: parsed.data.companyName,
    source: assigner?.fullName ?? 'Marketing',
    assignedToId: salesperson.id,
    createdById: userId,
    creatorRole: ctx.role,
    notes: parsed.data.handoffNotes,
  })

  if (result.duplicate) {
    throw new ConflictError(
      `This contact already has an open lead assigned to ${result.existingLead.assignedTo?.fullName ?? 'someone'} ` +
      `(${result.existingLead.stage}). Lead ID: ${result.existingLead.id}`
    )
  }

  await logAudit(
    orgId,
    userId,
    'UPDATE',
    'Contact',
    contact.id,
    `Assigned to ${salesperson.fullName} as lead ${result.lead.id}`
  )
  await logAudit(orgId, userId, 'ASSIGN', 'Lead', result.lead.id, result.lead.companyName, {
    assignedToId: salesperson.id,
    handoffNotes: parsed.data.handoffNotes,
  })

  return successResponse(result.lead, { statusCode: 201 })
})
