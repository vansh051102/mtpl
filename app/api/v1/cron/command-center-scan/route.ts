import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, UnauthorizedError } from '@/lib/api-response'
import { secureEqual } from '@/lib/secure-compare'
import { runCommandCenterAlertScan, computeDepartmentHealth } from '@/lib/command-center-engine'

// GET /api/v1/cron/command-center-scan — populates the CEO Command Center's
// owner alerts (AnomalyFlag: SLA_BREACH_STREAK, AGED_QUOTE_SENT) and
// DepartmentHealthSnapshot rows consumed by /dashboards/executive.
export const GET = withErrorHandler(async (req: Request) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !secureEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new UnauthorizedError('Invalid cron secret')
  }

  const alertResult = await runCommandCenterAlertScan()

  const orgs = await prisma.organization.findMany({ select: { id: true } })
  for (const org of orgs) {
    await computeDepartmentHealth(org.id)
  }

  return successResponse({ checkedAt: new Date().toISOString(), ...alertResult, orgsScored: orgs.length })
})
