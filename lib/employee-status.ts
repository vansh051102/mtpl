import { prisma } from './db'

const ONLINE_STALE_MS = 15 * 60 * 1000
const RECENT_ACTIVITY_MS = 5 * 60 * 1000

export type EmployeeStatus = 'AVAILABLE' | 'BUSY' | 'ON_CALL' | 'OFFLINE'

// ponytail: FACTORY status intentionally not implemented — no branch/floor
// check-in signal exists anywhere in the schema (no location/geofence data).
// Faking it would violate the "traceable metrics, no fabricated numbers" rule
// in docs/ENGINEERING_PRINCIPLES.md. Add it if/when a real check-in source exists.

interface StatusInput {
  liveAvailability: string
  lastLogin: Date | null
}

/** Derives a live status per user from real signals only: liveAvailability +
 * lastLogin freshness (from validate-headers.ts on each authenticated request),
 * plus in-progress `call`-type Activity rows (scheduledFor/duration overlap now). */
export async function resolveEmployeeStatuses(orgId: string, users: (StatusInput & { id: string })[]): Promise<Map<string, EmployeeStatus>> {
  const now = Date.now()
  const onlineUserIds = users
    .filter((u) => u.liveAvailability === 'ONLINE' && u.lastLogin && now - u.lastLogin.getTime() < ONLINE_STALE_MS)
    .map((u) => u.id)

  const statuses = new Map<string, EmployeeStatus>()
  for (const u of users) statuses.set(u.id, 'OFFLINE')
  if (onlineUserIds.length === 0) return statuses

  const inProgressCalls = await prisma.activity.findMany({
    where: {
      orgId,
      type: 'call',
      createdBy: { in: onlineUserIds },
      status: 'pending',
      scheduledFor: { lte: new Date(now) },
    },
    select: { createdBy: true, scheduledFor: true, duration: true },
  })
  const onCallUserIds = new Set(
    inProgressCalls
      .filter((a) => {
        if (!a.scheduledFor) return false
        const endsAt = a.scheduledFor.getTime() + (a.duration ?? 0) * 60 * 1000
        return endsAt >= now
      })
      .map((a) => a.createdBy)
  )

  const recentActivity = await prisma.activity.findMany({
    where: { orgId, createdBy: { in: onlineUserIds }, createdAt: { gte: new Date(now - RECENT_ACTIVITY_MS) } },
    select: { createdBy: true },
  })
  const busyUserIds = new Set(recentActivity.map((a) => a.createdBy))

  for (const id of onlineUserIds) {
    if (onCallUserIds.has(id)) statuses.set(id, 'ON_CALL')
    else if (busyUserIds.has(id)) statuses.set(id, 'BUSY')
    else statuses.set(id, 'AVAILABLE')
  }
  return statuses
}
