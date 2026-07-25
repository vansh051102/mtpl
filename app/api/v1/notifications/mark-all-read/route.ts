import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

// PATCH /api/v1/notifications/mark-all-read
export const PATCH = withErrorHandler(async (req: Request) => {
  const { orgId, userId } = await validateRequest(req)

  const result = await prisma.notification.updateMany({
    where: { orgId, userId, read: false },
    data: { read: true, readAt: new Date() },
  })

  return successResponse({ updated: result.count })
})
