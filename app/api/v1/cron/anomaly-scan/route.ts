import { successResponse, withErrorHandler, UnauthorizedError } from '@/lib/api-response'
import { secureEqual } from '@/lib/secure-compare'
import { runAnomalyDetection } from '@/lib/anomaly-detection'

// GET /api/v1/cron/anomaly-scan - Anti-gaming detection (Gap 22): velocity
// spikes, CTI/manual duration mismatches, and call-log modal spam. Flags for
// manager review (app/admin/workspace/[orgId]/anomaly-queue) rather than
// auto-blocking — false positives are cheap to review, expensive to enforce.
export const GET = withErrorHandler(async (req: Request) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !secureEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new UnauthorizedError('Invalid cron secret')
  }

  const result = await runAnomalyDetection()

  return successResponse({ checkedAt: new Date().toISOString(), ...result })
})
