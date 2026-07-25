import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { successResponse, withErrorHandler, NotFoundError, ConflictError } from '@/lib/api-response'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

interface Params {
  params: { id: string }
}

const LEASE_MINUTES = 5

// POST /api/v1/contacts/:id/lock - Acquire or renew (heartbeat) the call-log
// lease on a contact. Atomic conditional update, same claim-then-check
// pattern used by the cron jobs (see lib/__tests__/cron-concurrency): only
// succeeds if nobody else currently holds an unexpired lease.
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.ACTIVITIES_CREATE)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const now = new Date()
  const lockedUntil = new Date(now.getTime() + LEASE_MINUTES * 60_000)

  // A fresh acquire (nobody held it, it expired, or someone else lost the
  // race) is a "modal opened" event worth counting for anti-gaming (Gap 22).
  // The heartbeat re-POST every 30s while the same user already holds an
  // unexpired lease is not — logging that would just count normal call
  // duration as spam.
  const isFreshAcquire = !(contact.lockedByUserId === userId && contact.lockedUntil && contact.lockedUntil > now)

  const claimed = await prisma.contact.updateMany({
    where: {
      id: params.id,
      orgId,
      OR: [{ lockedByUserId: null }, { lockedUntil: { lt: now } }, { lockedByUserId: userId }],
    },
    data: { lockedByUserId: userId, lockedUntil },
  })

  if (claimed.count === 0) {
    const holder = await prisma.contact.findFirst({
      where: { id: params.id, orgId },
      select: { lockedByUserId: true },
    })
    const holderName = holder?.lockedByUserId
      ? (await prisma.user.findUnique({ where: { id: holder.lockedByUserId }, select: { fullName: true } }))?.fullName
      : null
    throw new ConflictError(
      holderName ? `This contact is currently being called by ${holderName}` : 'This contact is currently locked'
    )
  }

  if (isFreshAcquire) {
    await logAudit(orgId, userId, 'LOCK_ACQUIRE', 'Contact', contact.id, `${contact.firstName} ${contact.lastName}`)
  }

  return successResponse({ lockedByUserId: userId, lockedUntil })
})

// DELETE /api/v1/contacts/:id/lock - Release the lease early (modal closed/
// submitted). Idempotent: releasing a lease you don't hold is a no-op, not
// an error — the modal may close after the lease already expired.
export const DELETE = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx

  await prisma.contact.updateMany({
    where: { id: params.id, orgId, lockedByUserId: userId },
    data: { lockedByUserId: null, lockedUntil: null },
  })

  return successResponse({ released: true })
})
