import { prisma } from '@/lib/db'
import { computeOverallHealth } from '@/lib/business-health'
import { getExecutivePriorities } from '@/lib/executive-priorities'
import { getSalesScorecard, getLeadGenScorecard, getPurchaseScorecard } from '@/lib/department-scorecards'
import { getDepartmentComparison } from '@/lib/department-comparison'
import { getActivityFeed } from '@/lib/activity-feed'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequestWithRole } from '@/lib/middleware/validate-headers'

// GET /api/v1/command-center/control-plane — admin-only aggregated payload for
// the MTPL OS executive dashboard: health ring, priorities, department
// scorecards, goals-vs-achieved, today's tasks. Same admin-only gate as the
// sibling /command-center/executive route — the page's client-side redirect
// isn't a security boundary, so this enforces it server-side too.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequestWithRole(req, ['admin'])
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  const [health, priorities, sales, leadGen, purchase, targets, tasksToday, departmentComparison, activityFeed] = await Promise.all([
    computeOverallHealth(ctx.orgId),
    getExecutivePriorities(ctx.orgId),
    getSalesScorecard(ctx.orgId),
    getLeadGenScorecard(ctx.orgId),
    getPurchaseScorecard(ctx.orgId),
    prisma.target.findMany({ where: { orgId: ctx.orgId, periodStart } }),
    prisma.task.findMany({
      where: {
        orgId: ctx.orgId,
        assignedToId: ctx.userId,
        completedAt: null,
        dueAt: { gte: todayStart, lt: todayEnd },
      },
      orderBy: { dueAt: 'asc' },
    }),
    getDepartmentComparison(ctx.orgId),
    getActivityFeed(ctx.orgId),
  ])

  const scorecardValueFor = (department: string, metric: string): number => {
    if (department === 'Sales' && metric === 'revenue') return sales.revenue
    return 0
  }
  const goals = targets.map((t) => {
    const achievedValue = scorecardValueFor(t.department, t.metric)
    return {
      department: t.department,
      metric: t.metric,
      targetValue: t.targetValue,
      achievedValue,
      achievedPct: Math.round((achievedValue / Number(t.targetValue)) * 100),
    }
  })

  return successResponse({
    health,
    priorities,
    scorecards: { sales, leadGen, purchase },
    goals,
    tasksToday,
    departmentComparison,
    activityFeed,
  })
})
