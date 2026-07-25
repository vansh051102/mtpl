import { z } from 'zod'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { successResponse, withErrorHandler, NotFoundError, ValidationError } from '@/lib/api-response'
import { PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

const ResolveAnomalySchema = z.object({
  resolution: z.string().min(1, 'Explain the resolution'),
})

// POST /api/v1/admin/anomalies/:id/resolve
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(userId), PERMISSIONS.SETTINGS_EDIT)

  const body = await req.json()
  const parsed = ResolveAnomalySchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid resolution', parsed.error.flatten())

  const existing = await prisma.anomalyFlag.findFirst({ where: { id: params.id, orgId } })
  if (!existing) throw new NotFoundError('Anomaly flag')

  const flag = await prisma.anomalyFlag.update({
    where: { id: params.id },
    data: { resolvedAt: new Date(), resolvedBy: userId, resolution: parsed.data.resolution },
  })

  await logAudit(orgId, userId, 'UPDATE', 'AnomalyFlag', flag.id, flag.flagType, { resolution: parsed.data.resolution })

  return successResponse(flag)
})
