import { getActivityFeed } from '@/lib/activity-feed'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

// GET /api/v1/command-center/activity-feed — Apple Mail-style company timeline (§4/§10).
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const feed = await getActivityFeed(ctx.orgId)
  return successResponse(feed)
})
