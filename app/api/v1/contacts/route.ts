import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { CreateContactSchema } from '@/lib/validation'
import { PERMISSIONS } from '@/lib/rbac'
import { normalizeEmail, normalizePhone } from '@/lib/normalize'
import { checkContactDuplicate } from '@/lib/contact-duplicate-check'
import {
  successResponse,
  paginatedResponse,
  withErrorHandler,
  ValidationError,
  getPaginationParams,
} from '@/lib/api-response'
import { Prisma } from '@prisma/client'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { buildOwnershipFilterAsync } from '@/lib/ownership'
import { resolveMaskedFields, applyContactFieldMask } from '@/lib/contact-serializer'

// POST /api/v1/contacts - Create a contact
export const POST = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_CREATE)

  const body = await req.json()
  const parsed = CreateContactSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid contact data', parsed.error.flatten())
  }
  const input = parsed.data

  // Advisory pre-check: builds a rich 409 (existing lead + agent + actions)
  // instead of the DB's generic unique-constraint error. Race-safe fallback
  // below re-runs this same check if a concurrent submit slips past it.
  const preCheckDuplicate = await checkContactDuplicate(
    orgId,
    { phone: input.phone, email: input.email, gstNumber: input.gstNumber },
    { userId: ctx.userId, role: ctx.role }
  )
  if (preCheckDuplicate) throw preCheckDuplicate

  let contact
  try {
    contact = await prisma.contact.create({
      data: {
        orgId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: normalizeEmail(input.email),
        phone: normalizePhone(input.phone),
        alternatePhone: input.alternatePhone,
        designation: input.designation,
        gstNumber: input.gstNumber,
        source: input.source,
        sourceDetails: input.sourceDetails,
        tags: input.tags,
        createdById: userId,
      },
    })
  } catch (err) {
    // @@unique([orgId, email]) / @@unique([orgId, phone]) — the pre-check above
    // is advisory, not a lock, so a concurrent submit can still land here.
    // Re-run the same lookup to surface the same rich duplicate response.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raceDuplicate = await checkContactDuplicate(
        orgId,
        { phone: input.phone, email: input.email, gstNumber: input.gstNumber },
        { userId: ctx.userId, role: ctx.role }
      )
      throw raceDuplicate ?? err
    }
    throw err
  }

  await logAudit(orgId, userId, 'CREATE', 'Contact', contact.id, `${contact.firstName} ${contact.lastName}`)

  return successResponse(contact, { statusCode: 201 })
})

// GET /api/v1/contacts - List contacts with pagination & search
export const GET = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  const { orgId, userId, role } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.CONTACTS_READ)

  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)
  const search = url.searchParams.get('search')
  // Exact-match params for duplicate detection (used by the new-lead form)
  const phoneExact = url.searchParams.get('phone')
  const emailExact = url.searchParams.get('email')
  // 'assigned' | 'unassigned' — whether a Lead has been created from this contact
  const assignedFilter = url.searchParams.get('assigned')
  // 'New Lead' | 'Contacted' | 'Disqualified' — pre-Lead stage (lib/lead-stages.ts)
  const stageFilter = url.searchParams.get('stage')
  // 'today' | 'overdue' — nextFollowupDate bucket for the Lead Gen queue
  const followupFilter = url.searchParams.get('followup')

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)

  const ownershipFilter = await buildOwnershipFilterAsync(userId, role || 'admin', null, 'contacts')

  const where = {
    orgId,
    deletedAt: null,
    ...ownershipFilter,
    ...(assignedFilter === 'assigned' ? { leads: { some: {} } } : {}),
    ...(assignedFilter === 'unassigned' ? { leads: { none: {} } } : {}),
    ...(stageFilter ? { stage: stageFilter } : {}),
    ...(followupFilter === 'today' ? { nextFollowupDate: { gte: todayStart, lt: todayEnd } } : {}),
    ...(followupFilter === 'overdue' ? { nextFollowupDate: { lt: todayStart } } : {}),
    ...(phoneExact || emailExact
      ? {
          OR: [
            ...(phoneExact ? [{ phone: phoneExact }] : []),
            ...(emailExact ? [{ email: emailExact }] : []),
          ],
        }
      : search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      skip,
      take: limit,
      orderBy: followupFilter ? { nextFollowupDate: 'asc' as const } : { createdAt: 'desc' as const },
      include: {
        leads: {
          select: { id: true, stage: true, assignedTo: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.contact.count({ where }),
  ])

  const maskedFields = await resolveMaskedFields(orgId, ctx.userId, role || 'admin')
  const data = maskedFields.length ? contacts.map((c) => applyContactFieldMask(c, maskedFields)) : contacts

  return paginatedResponse(data, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  })
})
