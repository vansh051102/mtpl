import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, NotFoundError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

interface Params {
  params: { id: string }
}

// PATCH /api/v1/notifications/:id/read - Mark one notification read.
export const PATCH = withErrorHandler(async (req: Request, { params }: Params) => {
  const { orgId, userId } = await validateRequest(req)

  const existing = await prisma.notification.findFirst({ where: { id: params.id, orgId, userId } })
  if (!existing) throw new NotFoundError('Notification')

  const notification = await prisma.notification.update({
    where: { id: params.id },
    data: { read: true, readAt: new Date() },
  })

  return successResponse(notification)
})
