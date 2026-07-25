import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { LogContactCallSchema, SetContactReminderSchema } from '@/lib/validation'
import {
  successResponse,
  withErrorHandler,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '@/lib/api-response'
import { canAccessContact, PERMISSIONS } from '@/lib/rbac'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { assertContactVersion } from '@/lib/contact-workflow'
import { ForbiddenError } from '@/lib/errors'

interface Params {
  params: { id: string }
}

// POST /api/v1/contacts/:id/activities - Log a call or set a follow-up
// reminder against a Contact (pre-Lead lead-gen workflow). Mirrors
// /api/v1/leads/:id/activities but for the Contact stage before handoff.
export const POST = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.ACTIVITIES_CREATE)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  // DNC compliance (Gap 24): hard block, not a warning. Only the compliance
  // override endpoint (POST /compliance/dnc-override) can clear this.
  if (contact.isDncListed) {
    throw new ForbiddenError('This contact is Do-Not-Call listed and cannot be contacted')
  }

  // If someone else has the contact's call-log lease, block the write —
  // matches the lease acquired via POST /contacts/:id/lock.
  const now = new Date()
  if (contact.lockedByUserId && contact.lockedByUserId !== userId && contact.lockedUntil && contact.lockedUntil > now) {
    throw new ConflictError('This contact is currently being called by another user')
  }

  const body = await req.json()
  const type = body?.type
  if (type !== 'call' && type !== 'reminder') {
    throw new ValidationError('type must be "call" or "reminder"')
  }

  if (type === 'call') {
    const parsed = LogContactCallSchema.safeParse(body)
    if (!parsed.success) throw new ValidationError('Invalid call data', parsed.error.flatten())
    const { outcome, duration, notes, clientMutationId, expectedVersion } = parsed.data

    assertContactVersion(contact, expectedVersion)

    // Idempotency (offline-sync retry safety): a repeat submit with the same
    // clientMutationId returns the original activity instead of logging twice.
    if (clientMutationId) {
      const existing = await prisma.activity.findFirst({ where: { contactId: contact.id, clientMutationId } })
      if (existing) return successResponse(existing, { statusCode: 200 })
    }

    let activity
    try {
      ;[activity] = await prisma.$transaction([
        prisma.activity.create({
          data: {
            orgId,
            contactId: contact.id,
            type: 'call',
            title: `Call: ${outcome}`,
            description: notes,
            duration,
            status: 'completed',
            completedAt: now,
            metadata: { outcome },
            createdBy: userId,
            clientMutationId,
          },
        }),
        prisma.contact.update({
          where: { id: contact.id },
          data: {
            lastCallOutcome: outcome,
            lastCallDate: now,
            ...(outcome === 'Connected' && contact.stage === 'New Lead' && { stage: 'Contacted' }),
            ...(outcome === 'DND / Do Not Call' && {
              isDncListed: true,
              dncStatus: 'USER_OPT_OUT',
              consentTimestamp: now,
              optOutSource: 'CUSTOMER_REQUEST',
            }),
            version: { increment: 1 },
          },
        }),
      ])
    } catch (err) {
      if (clientMutationId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.activity.findFirst({ where: { contactId: contact.id, clientMutationId } })
        if (existing) return successResponse(existing, { statusCode: 200 })
      }
      throw err
    }

    await logAudit(orgId, userId, 'CREATE', 'Activity', activity.id, activity.title)
    return successResponse(activity, { statusCode: 201 })
  }

  const parsed = SetContactReminderSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid reminder data', parsed.error.flatten())
  const { dueDate, timeZone, note, clientMutationId, expectedVersion } = parsed.data

  assertContactVersion(contact, expectedVersion)

  if (clientMutationId) {
    const existing = await prisma.activity.findFirst({ where: { contactId: contact.id, clientMutationId } })
    if (existing) return successResponse(existing, { statusCode: 200 })
  }

  let activity
  try {
    ;[activity] = await prisma.$transaction([
      prisma.activity.create({
        data: {
          orgId,
          contactId: contact.id,
          type: 'reminder',
          title: 'Follow-up reminder',
          description: note,
          scheduledFor: dueDate,
          status: 'pending',
          metadata: { timeZone },
          createdBy: userId,
          clientMutationId,
        },
      }),
      prisma.contact.update({
        where: { id: contact.id },
        data: {
          nextFollowupDate: dueDate,
          nextFollowupTimeZone: timeZone,
          version: { increment: 1 },
        },
      }),
    ])
  } catch (err) {
    if (clientMutationId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.activity.findFirst({ where: { contactId: contact.id, clientMutationId } })
      if (existing) return successResponse(existing, { statusCode: 200 })
    }
    throw err
  }

  await logAudit(orgId, userId, 'CREATE', 'Activity', activity.id, activity.title)
  return successResponse(activity, { statusCode: 201 })
})

// GET /api/v1/contacts/:id/activities - List call/reminder history for a contact
export const GET = withErrorHandler(async (req: Request, { params }: Params) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.ACTIVITIES_READ)

  if (!(await canAccessContact(userId, role || 'admin', params.id))) {
    throw new NotFoundError('Contact')
  }

  const contact = await prisma.contact.findFirst({ where: { id: params.id, orgId, deletedAt: null } })
  if (!contact) throw new NotFoundError('Contact')

  const activities = await prisma.activity.findMany({
    where: { contactId: contact.id },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse(activities)
})
