import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withErrorHandler, successResponse, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['FOLLOWUP', 'REMINDER', 'CALL', 'MEETING']),
  dueAt: z.string().datetime(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
})

// GET /api/v1/tasks?due=today — backs the Business Calendar widget (§14) and
// the current user's own task list. Own-tasks only, no cross-tenant/cross-user leak.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const url = new URL(req.url)
  const due = url.searchParams.get('due')

  const dueAtFilter =
    due === 'today'
      ? { gte: new Date(new Date().setHours(0, 0, 0, 0)), lt: new Date(new Date().setHours(23, 59, 59, 999)) }
      : undefined

  const tasks = await prisma.task.findMany({
    where: { orgId: ctx.orgId, assignedToId: ctx.userId, completedAt: null, ...(dueAtFilter ? { dueAt: dueAtFilter } : {}) },
    orderBy: { dueAt: 'asc' },
    take: 50,
  })
  return successResponse(tasks)
})

// POST /api/v1/tasks — Owner Shortcuts "Add Reminder"/"Create Task" (§6).
export const POST = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const body = await req.json()
  const parsed = CreateTaskSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid task payload', parsed.error.flatten())

  const task = await prisma.task.create({
    data: { orgId: ctx.orgId, assignedToId: ctx.userId, ...parsed.data, dueAt: new Date(parsed.data.dueAt) },
  })
  return successResponse(task, { statusCode: 201 })
})
