import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler, UnauthorizedError } from '@/lib/api-response'
import { FOLLOW_UP_TITLE_PREFIX } from '@/lib/follow-up'
import { secureEqual } from '@/lib/secure-compare'

// GET /api/v1/cron/follow-up-nudges - Flag overdue Quote Sent follow-ups.
//
// For each pending follow-up task past its scheduled time, posts an
// "overdue" event to the lead's timeline (once per task) so the assigned
// rep sees the nudge on the lead detail page. Follow-ups on leads that have
// left Quote Sent are cancelled. Secured like sla-check:
//   Authorization: Bearer <CRON_SECRET>
export const GET = withErrorHandler(async (req: Request) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !secureEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new UnauthorizedError('Invalid cron secret')
  }

  const now = new Date()
  const overdue = await prisma.activity.findMany({
    where: {
      type: 'task',
      status: 'pending',
      title: { startsWith: FOLLOW_UP_TITLE_PREFIX },
      scheduledFor: { lt: now },
      leadId: { not: null }, // follow-up tasks are always Lead-linked, never Contact-linked
    },
    include: { lead: { select: { id: true, companyName: true, stage: true, orgId: true } } },
  })

  let nudged = 0
  let cancelled = 0
  for (const task of overdue) {
    if (!task.lead) continue // guaranteed by the leadId filter above
    const lead = task.lead // local const so the null-check narrows across the closure below
    const meta = (task.metadata ?? {}) as Record<string, unknown>
    if (meta.nudged) continue // already flagged on a previous run

    // Leads that left Quote Sent no longer need follow-ups; cancel them.
    if (lead.stage !== 'Quote Sent') {
      const cancelledNow = await prisma.activity.updateMany({
        where: { id: task.id, status: 'pending' },
        data: { status: 'cancelled' },
      })
      cancelled += cancelledNow.count
      continue
    }

    // Claim the task before writing the timeline entry. `overdue` was read once
    // at the top, so two overlapping runs both see nudged as unset and would
    // each append an "Overdue" event. A single UPDATE ... WHERE is atomic, so
    // exactly one runner matches and the rest fall through.
    //
    // Raw SQL rather than a Prisma JSON filter on purpose: the natural spelling
    // (NOT: { metadata: { path: ['nudged'], equals: true } }) silently matches
    // nothing when the key is absent, because metadata->'nudged' = true is NULL
    // and NOT NULL is NULL, not true. Every fresh task lacks the key, so that
    // form claimed no rows at all and would have disabled nudges entirely.
    // COALESCE on the extracted text makes the absent case explicit.
    const claimed = await prisma.$executeRaw`
      UPDATE "Activity"
      SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"nudged":true}'::jsonb
      WHERE id = ${task.id}
        AND status = 'pending'
        AND COALESCE(metadata->>'nudged', 'false') <> 'true'
    `
    if (claimed === 0) continue

    await prisma.$transaction(async (tx) => {
      const timeline = await tx.timeline.upsert({
        where: { leadId: lead.id },
        create: { leadId: lead.id, orgId: lead.orgId },
        update: {},
      })
      await tx.timelineEvent.create({
        data: {
          timelineId: timeline.id,
          type: 'follow_up_overdue',
          title: `Overdue: ${task.title}`,
          description: `Follow-up for ${lead.companyName} was due ${task.scheduledFor?.toISOString()}`,
          createdBy: 'system',
        },
      })
    })
    nudged++
  }

  return successResponse({ checkedAt: now.toISOString(), overdue: overdue.length, nudged, cancelled })
})
