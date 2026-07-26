import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
})

// PUT /api/v1/teams/:id - Rename and/or replace the full member set
export const PUT = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.TEAMS_MANAGE)

  const existing = await prisma.team.findFirst({ where: { id: params.id, orgId: ctx.orgId } })
  if (!existing) throw new NotFoundError('Team')

  const body = await req.json()
  const parsed = UpdateTeamSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid team data', parsed.error.flatten())
  }
  const { name, memberIds } = parsed.data

  if (memberIds) {
    const validCount = await prisma.user.count({ where: { id: { in: memberIds }, orgId: ctx.orgId } })
    if (validCount !== memberIds.length) {
      throw new ValidationError('One or more members do not belong to this organization')
    }
  }

  const team = await prisma.team.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(memberIds !== undefined && { members: { set: memberIds.map((id) => ({ id })) } }),
    },
    include: { members: { select: { id: true, fullName: true, role: true } } },
  })

  return successResponse(team)
})

// DELETE /api/v1/teams/:id - Delete the team (members' teamId clears via ON DELETE SET NULL)
export const DELETE = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.TEAMS_MANAGE)

  const existing = await prisma.team.findFirst({ where: { id: params.id, orgId: ctx.orgId } })
  if (!existing) throw new NotFoundError('Team')

  await prisma.team.delete({ where: { id: params.id } })

  return successResponse({ id: params.id, deleted: true })
})
