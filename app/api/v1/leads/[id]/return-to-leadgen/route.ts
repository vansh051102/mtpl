import { z } from 'zod'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { assertTransitionAllowed } from '@/lib/workflow'
import { closeOpenSlaClocks } from '@/lib/sla-engine'
import { canAccessLead, PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { StaleVersionError } from '@/lib/errors'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

const ReturnToLeadGenSchema = z.object({
  comment: z.string().min(10, 'Explain why this lead is being returned (min 10 characters)'),
  version: z.number().int().optional(),
})

// PATCH /api/v1/leads/:id/return-to-leadgen - Manager override (Gap 20): a
// Sales Manager can reject a stalled/low-quality handoff and send it back.
// Deliberately skips the SOP checklist-completion gate the normal stage
// route enforces (lib/sop-checklists.ts) — that gate exists to stop a rep
// from skipping steps while advancing a lead; closing a lead via manager
// override is the opposite direction and shouldn't require it.
export const PATCH = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.LEADS_ASSIGN)

  if (!(await canAccessLead(userId, role, params.id))) {
    throw new NotFoundError('Lead')
  }

  const lead = await prisma.lead.findFirst({
    where: { id: params.id, orgId },
    include: { contact: { select: { id: true, createdById: true } } },
  })
  if (!lead) throw new NotFoundError('Lead')

  const body = await req.json()
  const parsed = ReturnToLeadGenSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.flatten())
  const { comment, version: clientVersion } = parsed.data

  if (clientVersion !== undefined && clientVersion !== lead.version) {
    throw new StaleVersionError(lead)
  }

  const reason = 'Returned to Lead Gen'
  assertTransitionAllowed(lead, 'Disqualified', reason, role)

  const [updated] = await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        stage: 'Disqualified',
        stageChangedAt: new Date(),
        stageChangedBy: userId,
        dealLostReason: reason,
        dealLostDetails: comment,
        dealLostDate: new Date(),
        version: { increment: 1 },
      },
    }),
    prisma.notification.create({
      data: {
        orgId,
        userId: lead.contact.createdById,
        leadId: lead.id,
        type: 'sla_escalation',
        title: 'Lead returned by Sales',
        body: `${lead.companyName} was returned: ${comment}`,
      },
    }),
  ])

  await closeOpenSlaClocks(prisma, 'Lead', lead.id)
  await logAudit(orgId, userId, 'UPDATE', 'Lead', lead.id, `Returned to Lead Gen: ${comment}`, { reason, comment })

  return successResponse(updated)
})
