import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { UpdateActivitySchema } from '@/lib/validation'
import { canAccessLead, canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

// PUT /api/v1/activities/:id
export const PUT = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(
    await rbacService.getUserPermissions(ctx.userId),
    PERMISSIONS.ACTIVITIES_EDIT
  )

  const existing = await prisma.activity.findFirst({ where: { id: params.id, orgId } })
  if (!existing) throw new NotFoundError('Activity')
  const canAccess = existing.leadId
    ? await canAccessLead(ctx.userId, ctx.role, existing.leadId)
    : existing.contactId
    ? await canAccessContact(ctx.userId, ctx.role, existing.contactId)
    : false
  if (!canAccess) {
    throw new NotFoundError('Activity')
  }

  const body = await req.json()
  const parsed = UpdateActivitySchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid activity data', parsed.error.flatten())
  }
  const input = parsed.data

  const activity = await prisma.activity.update({
    where: { id: params.id },
    data: {
      ...input,
      ...(input.status === 'completed' &&
        existing.status !== 'completed' && { completedAt: new Date() }),
    },
  })

  await logAudit(orgId, userId, 'UPDATE', 'Activity', activity.id, activity.title, input)

  return successResponse(activity)
})

// DELETE /api/v1/activities/:id
export const DELETE = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(
    await rbacService.getUserPermissions(ctx.userId),
    PERMISSIONS.ACTIVITIES_DELETE
  )

  const existing = await prisma.activity.findFirst({ where: { id: params.id, orgId } })
  if (!existing) throw new NotFoundError('Activity')
  const canAccess = existing.leadId
    ? await canAccessLead(ctx.userId, ctx.role, existing.leadId)
    : existing.contactId
    ? await canAccessContact(ctx.userId, ctx.role, existing.contactId)
    : false
  if (!canAccess) {
    throw new NotFoundError('Activity')
  }

  await prisma.activity.delete({ where: { id: params.id } })

  await logAudit(orgId, userId, 'DELETE', 'Activity', existing.id, existing.title)

  return successResponse({ id: existing.id, deleted: true })
})
