import { z } from 'zod'
import { prisma } from '@/lib/db'
import { PERMISSIONS } from '@/lib/rbac'
import { successResponse, withErrorHandler, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(64),
  memberIds: z.array(z.string().uuid()).optional().default([]),
})

// GET /api/v1/teams - List org teams with member summaries (admin only)
export const GET = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.TEAMS_MANAGE)

  const teams = await prisma.team.findMany({
    where: { orgId: ctx.orgId },
    include: { members: { select: { id: true, fullName: true, role: true } } },
    orderBy: { name: 'asc' },
  })

  return successResponse(teams)
})

// POST /api/v1/teams - Create a team, optionally seeding members
export const POST = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.TEAMS_MANAGE)

  const body = await req.json()
  const parsed = CreateTeamSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid team', parsed.error.flatten())
  }
  const { name, memberIds } = parsed.data

  if (memberIds.length) {
    const validCount = await prisma.user.count({ where: { id: { in: memberIds }, orgId: ctx.orgId } })
    if (validCount !== memberIds.length) {
      throw new ValidationError('One or more members do not belong to this organization')
    }
  }

  const team = await prisma.team.create({
    data: {
      orgId: ctx.orgId,
      name,
      members: memberIds.length ? { connect: memberIds.map((id) => ({ id })) } : undefined,
    },
    include: { members: { select: { id: true, fullName: true, role: true } } },
  })

  return successResponse(team, { statusCode: 201 })
})
