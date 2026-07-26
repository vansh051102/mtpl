import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { CreateLeadSchema, LEAD_STAGES, LEAD_PRIORITIES } from '@/lib/validation'
import { AppError, DuplicateContactError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  successResponse,
  paginatedResponse,
  withErrorHandler,
  NotFoundError,
  ValidationError,
  InternalServerError,
  getPaginationParams,
} from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { buildOwnershipFilterAsync, canAccessLead, PERMISSIONS } from '@/lib/rbac'
import { parseAdvancedLeadFilters, buildAdvancedLeadWhere, ADVANCED_LEAD_SORT_FIELDS } from '@/lib/lead-filters'
import { resolveMaskedFields, applyLeadFieldMask } from '@/lib/lead-serializer'
import { DEPARTMENTS, getDepartmentWhereClause } from '@/lib/lead-department'
import { stageQueryValues } from '@/lib/lead-stages'

// Lead.status values set by the stage-change route (app/api/v1/leads/[id]/stage/route.ts)
// — not previously exposed as a list filter.
const LEAD_STATUSES = ['open', 'closed_won', 'closed_lost', 'disqualified']

// POST /api/v1/leads - Create a lead (Step 1 of the workflow)
export const POST = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(
    await rbacService.getUserPermissions(ctx.userId),
    PERMISSIONS.LEADS_CREATE
  )

  const body = await req.json()
  const parsed = CreateLeadSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid lead data', parsed.error.flatten())
  }
  const input = parsed.data

  // Contact must belong to the same org
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, orgId: ctx.orgId, deletedAt: null },
  })
  if (!contact) throw new NotFoundError('Contact')

  // Frontend sets sourceDetails.repeatOf when the user chose "log as repeat
  // enquiry" on a duplicate banner — intentionally creates a second lead for
  // the same contact instead of being blocked by the open-lead check.
  const repeatOfLeadId = (input.sourceDetails as { repeatOf?: string } | undefined)?.repeatOf

  // Builds the same rich 409 whether the open-lead duplicate was caught by
  // the advisory pre-check inside createLeadWithDefaults, or (race case)
  // slipped past it and only surfaced as a P2002 from the DB — re-runs the
  // lookup so both paths give the user the same view/logAsRepeat/reassign
  // banner instead of the second path falling back to a raw DB error.
  async function buildOpenLeadDuplicateError(existingLead: {
    id: string
    companyName: string
    stage: string
    assignedTo: { fullName: string } | null
  }) {
    const canView = await canAccessLead(ctx.userId, ctx.role, existingLead.id)
    if (!canView) {
      return new DuplicateContactError(
        'This contact already has an open lead under another agent. Contact admin to reassign.',
        {
          reason: 'open_lead',
          existingContact: { id: input.contactId, firstName: '', lastName: '' },
          existingLead: null,
          actions: ['reassign'],
        }
      )
    }
    return new DuplicateContactError(
      `This contact already has an open lead: ${existingLead.companyName} ` +
        `(${existingLead.stage}), assigned to ${existingLead.assignedTo?.fullName ?? 'unassigned'}.`,
      {
        reason: 'open_lead',
        existingContact: { id: input.contactId, firstName: '', lastName: '' },
        existingLead,
        actions: ['view', 'logAsRepeat', 'reassign'],
      }
    )
  }

  // createLeadWithDefaults's transaction body calls pickAssignee/startSlaClock/
  // createSopChecklistsForStage — a bug or missing-config edge case in any of
  // those throws a plain, unnamed Error that would otherwise fall through
  // errorResponse()'s catch-all as an opaque "Unexpected error occurred" even
  // though nothing about the user's input was invalid. Surface it as a
  // scoped, retry-able message instead, while still logging the real cause.
  let result
  try {
    result = await createLeadWithDefaults({
      orgId: ctx.orgId,
      contactId: input.contactId,
      companyName: input.companyName,
      priority: input.priority,
      notes: input.notes,
      source: input.source,
      sourceDetails: input.sourceDetails,
      tags: input.tags,
      createdById: ctx.userId,
      creatorRole: ctx.role,
      allowRepeat: Boolean(repeatOfLeadId),
      closingHorizon: input.closingHorizon,
      targetClosingDate: input.targetClosingDate,
      territory: input.territory,
      serviceArea: input.serviceArea,
      pinCode: input.pinCode,
      customerSegment: input.customerSegment,
      productCategory: input.productCategory,
      requirement: input.requirement,
    })
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Advisory pre-check was raced — re-run the same open-lead lookup used
      // inside createLeadWithDefaults to build the same rich response.
      const existingLead = await prisma.lead.findFirst({
        where: {
          orgId: ctx.orgId,
          contactId: input.contactId,
          stage: { notIn: ['Order Confirmed', 'Order Closed', 'Deal Lost', 'Disqualified', 'Closed Won'] },
        },
        select: { id: true, companyName: true, stage: true, assignedTo: { select: { fullName: true } } },
      })
      throw existingLead ? await buildOpenLeadDuplicateError(existingLead) : err
    }
    logger.error({ err }, 'createLeadWithDefaults failed unexpectedly')
    throw new InternalServerError('Could not create lead — please retry')
  }

  if (result.duplicate) {
    throw await buildOpenLeadDuplicateError(result.existingLead)
  }

  await logAudit(ctx.orgId, ctx.userId, 'CREATE', 'Lead', result.lead.id, result.lead.companyName)

  return successResponse(result.lead, { statusCode: 201 })
})

// GET /api/v1/leads - List leads with pagination & filters
// Admin may pass ?viewAsUserId=<id> to see leads scoped to another user's role.
export const GET = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  rbacService.requirePermission(
    await rbacService.getUserPermissions(ctx.userId),
    PERMISSIONS.LEADS_READ
  )

  const url = new URL(req.url)
  const { page, limit, skip } = getPaginationParams(url.searchParams)

  // Resolve effective user context for viewAs impersonation (admin only)
  const viewAsUserId = url.searchParams.get('viewAsUserId')
  let effectiveUserId = ctx.userId
  let effectiveRole = ctx.role
  let effectiveDepartment: string | null = ctx.department

  if (viewAsUserId && ctx.role === 'admin') {
    const viewAsUser = await prisma.user.findFirst({
      where: { id: viewAsUserId, orgId: ctx.orgId },
      select: { id: true, role: true, department: true },
    })
    if (viewAsUser) {
      effectiveUserId = viewAsUser.id
      effectiveRole = viewAsUser.role
      effectiveDepartment = viewAsUser.department
    }
  }

  const stage = url.searchParams.get('stage')
  const department = url.searchParams.get('department')
  const status = url.searchParams.get('status') // open | closed_won | closed_lost | disqualified
  const priority = url.searchParams.get('priority')
  const assignedToId = url.searchParams.get('assignedToId')
  const contactOutcome = url.searchParams.get('contactOutcome') // connected | not_received
  const slaBreached = url.searchParams.get('slaBreached')
  const search = url.searchParams.get('search')
  const days = url.searchParams.get('days') // quick time-range filter: 7 / 30 / 90
  const from = url.searchParams.get('from') // custom range (ISO date)
  const to = url.searchParams.get('to')
  const sortBy = url.searchParams.get('sortBy') || 'createdAt'
  const sortDir = url.searchParams.get('sortDir') === 'asc' ? 'asc' : ('desc' as const)

  const SORTABLE = [
    'createdAt',
    'companyName',
    'priority',
    'stage',
    'lastActivityAt',
    'slaDeadline',
    ...ADVANCED_LEAD_SORT_FIELDS,
  ]
  if (!SORTABLE.includes(sortBy)) {
    throw new ValidationError(`Invalid sortBy: ${sortBy}. Allowed: ${SORTABLE.join(', ')}`)
  }
  if ((from && isNaN(Date.parse(from))) || (to && isNaN(Date.parse(to)))) {
    throw new ValidationError('Invalid from/to date')
  }

  if (stage && !(LEAD_STAGES as readonly string[]).includes(stage)) {
    throw new ValidationError(`Invalid stage filter: ${stage}`)
  }
  if (department && !(DEPARTMENTS as readonly string[]).includes(department)) {
    throw new ValidationError(`Invalid department filter: ${department}. Allowed: ${DEPARTMENTS.join(', ')}`)
  }
  if (status && !LEAD_STATUSES.includes(status)) {
    throw new ValidationError(`Invalid status filter: ${status}. Allowed: ${LEAD_STATUSES.join(', ')}`)
  }
  if (priority && !(LEAD_PRIORITIES as readonly string[]).includes(priority)) {
    throw new ValidationError(`Invalid priority filter: ${priority}`)
  }
  if (days && (!/^\d+$/.test(days) || Number(days) <= 0 || Number(days) > 365)) {
    throw new ValidationError(`Invalid days filter: ${days}`)
  }
  if (contactOutcome && !['connected', 'not_received'].includes(contactOutcome)) {
    throw new ValidationError(`Invalid contactOutcome filter: ${contactOutcome}`)
  }

  const ownershipFilter = await buildOwnershipFilterAsync(
    effectiveUserId,
    effectiveRole,
    effectiveDepartment,
    'leads'
  )

  const orgSettings = await prisma.settings.findUnique({
    where: { orgId: ctx.orgId },
    select: { timezone: true },
  })
  const advancedFilters = buildAdvancedLeadWhere(
    parseAdvancedLeadFilters(url.searchParams),
    orgSettings?.timezone ?? 'Asia/Kolkata'
  )

  const where = {
    orgId: ctx.orgId,
    ...ownershipFilter,
    // stageQueryValues includes the legacy 'Closed Won' alias when filtering
    // for 'Order Confirmed' — every other stage-aware query in the app
    // already accounts for it (lib/ownership.ts, leads/stats, performance,
    // analytics, leads-kanban); an exact-match filter here would silently
    // hide those rows from this tab.
    ...(stage && { stage: { in: stageQueryValues(stage) } }),
    ...(priority && { priority }),
    ...(assignedToId && { assignedToId }),
    // "not_received" also covers leads with no call logged yet (null outcome)
    ...(contactOutcome === 'connected' && { contactOutcome: 'connected' }),
    ...(contactOutcome === 'not_received' && { NOT: { contactOutcome: 'connected' } }),
    ...(slaBreached === 'true' && { slaBreached: true }),
    ...(status && { status }),
    ...((days || from || to) && {
      createdAt: {
        ...(days && { gte: new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000) }),
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) }),
      },
    }),
    ...(search && {
      OR: [
        { companyName: { contains: search, mode: 'insensitive' as const } },
        { notes: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...advancedFilters,
    // AND, not spread — department's where-fragment can itself set `stage`
    // (e.g. Sales -> Qualified), which would silently clobber an ambient
    // `stage` param key if spread at the top level. AND composes both.
    ...(department && { AND: [getDepartmentWhereClause(department)] }),
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortDir },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        createdBy: { select: { id: true, fullName: true } },
        quotes: {
          select: { id: true, quoteNumber: true, status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        activities: {
          select: { type: true, title: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        // Bounded (a lead has at most a handful of PRs) — feeds the
        // client-side department badge (lib/lead-department.ts), not
        // pagination-sensitive like activities/quotes above.
        purchaseRequests: { select: { status: true } },
      },
    }),
    prisma.lead.count({ where }),
  ])

  const enriched = leads.map((lead) => {
    const latest = lead.activities[0]
    const latestQuote = lead.quotes[0] ?? null
    const activityLabel = latest?.title || latest?.type || 'Updated'
    let stageDetails = 'No stage details'
    if (lead.dealLostReason) {
      stageDetails = lead.dealLostDetails
        ? `${lead.dealLostReason}: ${lead.dealLostDetails}`
        : lead.dealLostReason
    } else if (lead.quotationNumber) {
      stageDetails = `Quote ${lead.quotationNumber}`
    } else if (latestQuote) {
      stageDetails = `Quote ${latestQuote.quoteNumber}`
    } else if (lead.requirement) {
      stageDetails = lead.requirement.slice(0, 80)
    }

    const { activities, quotes, ...rest } = lead
    return {
      ...rest,
      latestQuote,
      hasQuote: Boolean(latestQuote || lead.quotationNumber),
      lastActivityLabel: activityLabel,
      stageDetails,
    }
  })

  const maskedFields = await resolveMaskedFields(ctx.orgId, ctx.userId, ctx.role)
  const masked = maskedFields.length
    ? enriched.map((lead) => applyLeadFieldMask(lead, maskedFields))
    : enriched

  return paginatedResponse(masked, {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  })
})
