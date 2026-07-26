import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withErrorHandler, successResponse, ForbiddenError, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

const CreateTargetSchema = z.object({
  department: z.enum(['Sales', 'Marketing', 'Purchase']),
  metric: z.string().min(1),
  period: z.literal('MONTH'),
  periodStart: z.string().datetime(),
  targetValue: z.number().positive(),
})

// GET /api/v1/targets — this month's targets by default.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const url = new URL(req.url)
  const department = url.searchParams.get('department')
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const targets = await prisma.target.findMany({
    where: { orgId: ctx.orgId, periodStart, ...(department ? { department } : {}) },
    orderBy: { department: 'asc' },
  })
  return successResponse(targets)
})

// POST /api/v1/targets — admin sets a monthly target (Business Goals, §15).
export const POST = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  if (ctx.role !== 'admin') throw new ForbiddenError('Only admins can set business goals')

  const body = await req.json()
  const parsed = CreateTargetSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid target payload', parsed.error.flatten())

  const target = await prisma.target.upsert({
    where: {
      orgId_department_metric_period_periodStart: {
        orgId: ctx.orgId,
        department: parsed.data.department,
        metric: parsed.data.metric,
        period: parsed.data.period,
        periodStart: new Date(parsed.data.periodStart),
      },
    },
    create: { orgId: ctx.orgId, ...parsed.data, periodStart: new Date(parsed.data.periodStart) },
    update: { targetValue: parsed.data.targetValue },
  })
  return successResponse(target, { statusCode: 201 })
})
