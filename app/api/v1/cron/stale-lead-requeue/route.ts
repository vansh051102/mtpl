import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, UnauthorizedError } from '@/lib/api-response'
import { secureEqual } from '@/lib/secure-compare'

// Wall-clock threshold, not business-hours-adjusted — same simplicity level
// as follow-up-nudges' overdue check. Add BusinessCalendar awareness later
// if plain-hours turns out too aggressive/lax in practice.
const STALE_HOURS = 4
const BATCH_SIZE = 50

/** Active Marketing user with the fewest open leads, excluding `excludeUserId`
 * (the stale lead's current owner — the point of re-queuing is to hand it to
 * someone else). Mirrors pickAssignee's "least_open_leads" heuristic
 * (lib/auto-assign.ts) but scoped for re-queue rather than lead-creation. */
async function pickNextAvailable(orgId: string, excludeUserId: string): Promise<string | null> {
  const users = await prisma.user.findMany({
    where: { orgId, status: 'active', department: 'Marketing', role: { not: 'admin' }, id: { not: excludeUserId } },
    select: { id: true },
  })
  if (users.length === 0) return null

  const counts = await prisma.lead.groupBy({
    by: ['assignedToId'],
    where: { orgId, status: 'open', assignedToId: { not: null } },
    _count: { _all: true },
  })
  const countByUser = new Map(counts.map((c) => [c.assignedToId as string, c._count._all]))

  let best: string | null = null
  let bestCount = Number.POSITIVE_INFINITY
  for (const user of users) {
    const count = countByUser.get(user.id) ?? 0
    if (count < bestCount) {
      best = user.id
      bestCount = count
    }
  }
  return best
}

// GET /api/v1/cron/stale-lead-requeue - Gap 14 fair-share: a lead sitting in
// New Lead, assigned but untouched for STALE_HOURS, is handed to the next
// available Marketing rep instead of one person quietly sitting on it.
export const GET = withErrorHandler(async (req: Request) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !secureEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new UnauthorizedError('Invalid cron secret')
  }

  const staleThreshold = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000)

  const stale = await prisma.lead.findMany({
    where: {
      stage: 'New Lead',
      assignedToId: { not: null },
      lastActivityAt: { lt: staleThreshold },
      deletedAt: null,
    },
    orderBy: { lastActivityAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true, orgId: true, assignedToId: true, lastActivityAt: true },
  })

  let reassigned = 0
  let skipped = 0

  for (const lead of stale) {
    const nextAssignee = await pickNextAvailable(lead.orgId, lead.assignedToId as string)
    if (!nextAssignee) {
      skipped++
      continue
    }

    // Atomic claim: only reassign if this lead is still exactly as read
    // (same assignee, same lastActivityAt) — protects against a concurrent
    // action (e.g. the rep just called it) racing this cron.
    const claimed = await prisma.lead.updateMany({
      where: { id: lead.id, assignedToId: lead.assignedToId, lastActivityAt: lead.lastActivityAt },
      data: { assignedToId: nextAssignee, assignedAt: new Date(), lastActivityAt: new Date() },
    })
    if (claimed.count === 0) {
      skipped++
      continue
    }

    await prisma.activity.create({
      data: {
        orgId: lead.orgId,
        leadId: lead.id,
        type: 'note',
        title: 'Auto-reassigned (stale)',
        description: `Untouched for ${STALE_HOURS}+ hours — reassigned to the next available rep.`,
        status: 'completed',
        completedAt: new Date(),
        metadata: { previousAssigneeId: lead.assignedToId, newAssigneeId: nextAssignee, reason: 'stale_requeue' },
        createdBy: 'system',
      },
    })
    reassigned++
  }

  return successResponse({ checkedAt: new Date().toISOString(), found: stale.length, reassigned, skipped })
})
