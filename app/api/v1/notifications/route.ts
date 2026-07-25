import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, getPaginationParams } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

// GET /api/v1/notifications - The caller's own notifications, unread first.
// Self-scoped by userId — no resource permission needed, every authenticated
// user sees their own inbox regardless of role.
export const GET = withErrorHandler(async (req) => {
  const { orgId, userId } = await validateRequest(req)

  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)
  const unreadOnly = url.searchParams.get('unread') === 'true'

  const where = { orgId, userId, ...(unreadOnly ? { read: false } : {}) }

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ read: 'asc' as const }, { createdAt: 'desc' as const }],
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { orgId, userId, read: false } }),
  ])

  // Not paginatedResponse's shape — this route also needs unreadCount
  // alongside the page, which that shared envelope doesn't carry.
  return successResponse({
    notifications,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    unreadCount,
  })
})
