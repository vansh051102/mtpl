import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, ForbiddenError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { ALL_STAGES, stageQueryValues } from '@/lib/lead-stages'

const VALID_DEPARTMENTS = ['sales', 'marketing', 'purchase']

// GET /api/v1/command-center/funnels/[department] — pipeline funnel for
// sales/marketing (real 8-stage Lead pipeline), or a status breakdown for
// purchase (PurchaseRequest has no stage funnel, only a flat status field).
export const GET = withErrorHandler(async (req: Request, { params }: { params: { department: string } }) => {
  const ctx = await validateRequest(req)
  const department = params.department.toLowerCase()

  if (!VALID_DEPARTMENTS.includes(department)) {
    throw new ForbiddenError(`Unknown department: ${params.department}`)
  }
  const isOwnDepartment = ctx.department?.toLowerCase() === department
  if (ctx.role !== 'admin' && !isOwnDepartment) {
    throw new ForbiddenError('You can only view your own department funnel')
  }

  if (department === 'purchase') {
    const counts = await prisma.purchaseRequest.groupBy({
      by: ['status'],
      where: { orgId: ctx.orgId },
      _count: { _all: true },
    })
    return successResponse({
      department: 'purchase',
      kind: 'status_breakdown',
      counts: counts.map((c) => ({ status: c.status, count: c._count._all })),
    })
  }

  const counts = await prisma.lead.groupBy({
    by: ['stage'],
    where: { orgId: ctx.orgId, isArchived: false },
    _count: { _all: true },
  })
  const stages = ALL_STAGES.map((stage) => ({
    stage,
    count: stageQueryValues(stage).reduce(
      (sum, value) => sum + (counts.find((c) => c.stage === value)?._count._all ?? 0),
      0
    ),
  }))

  return successResponse({ department, kind: 'funnel', stages })
})
