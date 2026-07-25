import { prisma } from './db'
import { createChildLogger } from './logger'

const log = createChildLogger('anomaly-detection')

const VELOCITY_WINDOW_MS = 5 * 60 * 1000
const VELOCITY_THRESHOLD = 15
const MODAL_SPAM_WINDOW_MS = 60 * 60 * 1000
const MODAL_SPAM_THRESHOLD = 30
// Don't re-flag the same user for the same reason more than once per window
// — a cron running every few minutes would otherwise spam the queue with
// near-duplicate flags for one ongoing burst.
const DEDUPE_WINDOW_MS = 60 * 60 * 1000

async function alreadyFlaggedRecently(orgId: string, userId: string, flagType: string): Promise<boolean> {
  const existing = await prisma.anomalyFlag.findFirst({
    where: {
      orgId,
      userId,
      flagType,
      resolvedAt: null,
      flaggedAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  })
  return Boolean(existing)
}

/** 15+ Activity rows created by one user within 5 minutes — logging calls
 * faster than a real conversation could plausibly happen. Flat query across
 * all orgs (same pattern as the SLA/follow-up crons), grouped by
 * (orgId, createdBy) so one org's volume never trips another's threshold. */
async function detectVelocitySpikes(): Promise<number> {
  const since = new Date(Date.now() - VELOCITY_WINDOW_MS)
  const counts = await prisma.activity.groupBy({
    by: ['orgId', 'createdBy'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  })

  let flagged = 0
  for (const row of counts) {
    if (row._count._all < VELOCITY_THRESHOLD) continue
    if (row.createdBy === 'system') continue
    if (await alreadyFlaggedRecently(row.orgId, row.createdBy, 'VELOCITY_SPIKE')) continue

    await prisma.anomalyFlag.create({
      data: {
        orgId: row.orgId,
        userId: row.createdBy,
        flagType: 'VELOCITY_SPIKE',
        severity: 'HIGH',
        description: `${row._count._all} activities logged in the last 5 minutes`,
      },
    })
    flagged++
  }
  return flagged
}

/** Surfaces the CTI reconciliation mismatch (the CTI webhook route already
 * sets metadata.flag = 'SHORT_CALL_UNVERIFIED' when a manually-logged call
 * claims minutes of duration but the provider's telemetry shows under 10s)
 * as a reviewable AnomalyFlag instead of a metadata field nobody looks at. */
const DURATION_MISMATCH_SCAN_LIMIT = 200

async function detectDurationMismatches(): Promise<number> {
  const orgs = await prisma.activity.findMany({
    where: { type: 'call', contactId: { not: null } },
    distinct: ['orgId'],
    select: { orgId: true },
  })

  let flagged = 0
  for (const { orgId } of orgs) {
    const candidates = await prisma.activity.findMany({
      where: { orgId, type: 'call', contactId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: DURATION_MISMATCH_SCAN_LIMIT,
      select: { id: true, orgId: true, contactId: true, createdBy: true, metadata: true },
    })
    if (candidates.length === DURATION_MISMATCH_SCAN_LIMIT) {
      log.warn({ orgId, limit: DURATION_MISMATCH_SCAN_LIMIT }, 'duration-mismatch scan hit per-org cap, older activity was not scanned')
    }

    for (const activity of candidates) {
      const meta = activity.metadata as Record<string, unknown> | null
      if (meta?.flag !== 'SHORT_CALL_UNVERIFIED') continue

      const alreadyFlaggedForThisActivity = await prisma.anomalyFlag.findFirst({
        where: {
          orgId: activity.orgId,
          contactId: activity.contactId,
          flagType: 'DURATION_MISMATCH',
          description: { contains: activity.id },
        },
        select: { id: true },
      })
      if (alreadyFlaggedForThisActivity) continue

      await prisma.anomalyFlag.create({
        data: {
          orgId: activity.orgId,
          userId: activity.createdBy,
          contactId: activity.contactId,
          flagType: 'DURATION_MISMATCH',
          severity: 'MEDIUM',
          description: `Manual call duration doesn't match CTI telemetry (activity ${activity.id})`,
        },
      })
      flagged++
    }
  }
  return flagged
}

/** 30+ fresh call-log lease acquisitions by one user in an hour — rapidly
 * opening/closing the Call Log modal without logging outcomes, a pattern
 * consistent with inflating "calls attempted" metrics. */
async function detectModalSpam(): Promise<number> {
  const since = new Date(Date.now() - MODAL_SPAM_WINDOW_MS)
  const acquisitions = await prisma.auditLog.groupBy({
    by: ['orgId', 'userId'],
    where: { action: 'LOCK_ACQUIRE', timestamp: { gte: since } },
    _count: { _all: true },
  })

  let flagged = 0
  for (const row of acquisitions) {
    if (row._count._all < MODAL_SPAM_THRESHOLD) continue
    if (await alreadyFlaggedRecently(row.orgId, row.userId, 'MODAL_SPAM')) continue

    await prisma.anomalyFlag.create({
      data: {
        orgId: row.orgId,
        userId: row.userId,
        flagType: 'MODAL_SPAM',
        severity: 'MEDIUM',
        description: `Call Log opened ${row._count._all} times in the last hour`,
      },
    })
    flagged++
  }
  return flagged
}

export async function runAnomalyDetection() {
  const [velocitySpikes, durationMismatches, modalSpam] = await Promise.all([
    detectVelocitySpikes(),
    detectDurationMismatches(),
    detectModalSpam(),
  ])
  return { velocitySpikes, durationMismatches, modalSpam }
}
