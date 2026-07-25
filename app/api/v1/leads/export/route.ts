import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { toCsv } from '@/lib/csv'
import { toJson, toXlsx, toPdf, type ExportRow } from '@/lib/export-formats'
import { logAudit } from '@/lib/audit'
import { LEAD_STAGES, LEAD_PRIORITIES } from '@/lib/validation'
import { PERMISSIONS } from '@/lib/rbac'
import { withErrorHandler, ValidationError, ForbiddenError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { buildOwnershipFilter } from '@/lib/ownership'
import { rbacService } from '@/lib/services/rbac.service'
import { parseAdvancedLeadFilters, buildAdvancedLeadWhere } from '@/lib/lead-filters'
import { resolveMaskedFields } from '@/lib/lead-serializer'
import { DEPARTMENTS, getDepartmentWhereClause } from '@/lib/lead-department'

const HARD_EXPORT_LIMIT = 5000
const PDF_ROW_CAP = 500
const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'json'] as const
const EXPORT_TYPES = ['deals_lost', 'deals_won', 'history'] as const

/** Mask all but the last 4 characters. Empty/short values pass through untouched. */
function maskValue(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (!str || str.length <= 4) return str
  return `${'*'.repeat(str.length - 4)}${str.slice(-4)}`
}

function ipFromRequest(req: Request): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

// GET /api/v1/leads/export - Download leads as CSV/XLSX/PDF/JSON. Accepts the
// same filters as GET /leads (stage, priority, days, search, advanced), plus
// multi-source and day-of-week filtering, an export `format`, and an
// `exportType` (deals_lost/deals_won/history) that adds outcome-specific
// columns and forces the matching stage filter. Enforces the requesting
// role's daily export quota and field-level masking policy.
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const { orgId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.LEADS_EXPORT)

  const url = new URL(req.url)
  const stage = url.searchParams.get('stage')
  const department = url.searchParams.get('department')
  const priority = url.searchParams.get('priority')
  const days = url.searchParams.get('days')
  const search = url.searchParams.get('search')
  const sources = url.searchParams.getAll('source').filter(Boolean)
  const weekdays = url.searchParams
    .getAll('weekday')
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) // 1=Monday..7=Sunday

  const format = (url.searchParams.get('format') || 'csv') as (typeof EXPORT_FORMATS)[number]
  if (!EXPORT_FORMATS.includes(format)) {
    throw new ValidationError(`Invalid format: ${format}. Allowed: ${EXPORT_FORMATS.join(', ')}`)
  }
  const exportType = url.searchParams.get('exportType') as (typeof EXPORT_TYPES)[number] | null
  if (exportType && !EXPORT_TYPES.includes(exportType)) {
    throw new ValidationError(`Invalid exportType: ${exportType}. Allowed: ${EXPORT_TYPES.join(', ')}`)
  }

  if (stage && !(LEAD_STAGES as readonly string[]).includes(stage)) {
    throw new ValidationError(`Invalid stage filter: ${stage}`)
  }
  if (department && !(DEPARTMENTS as readonly string[]).includes(department)) {
    throw new ValidationError(`Invalid department filter: ${department}. Allowed: ${DEPARTMENTS.join(', ')}`)
  }
  if (priority && !(LEAD_PRIORITIES as readonly string[]).includes(priority)) {
    throw new ValidationError(`Invalid priority filter: ${priority}`)
  }

  // Resolve the requester's role policy. Admins bypass masking and quota.
  const isAdmin = ctx.role === 'admin'
  const roleRow = isAdmin
    ? null
    : await prisma.role.findFirst({
        where: { orgId, name: ctx.role },
        select: { maxExportLimitDaily: true, maskPiiData: true },
      })
  const maskPii = roleRow?.maskPiiData ?? true
  const dailyLimit = isAdmin ? HARD_EXPORT_LIMIT : (roleRow?.maxExportLimitDaily ?? 100)

  if (!isAdmin) {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const todaysExports = await prisma.auditLog.findMany({
      where: { orgId, userId: ctx.userId, action: 'EXPORT', resourceType: 'Lead', timestamp: { gte: startOfDay } },
      select: { changes: true },
    })
    const exportedToday = todaysExports.reduce(
      (sum, e) => sum + (typeof (e.changes as any)?.count === 'number' ? (e.changes as any).count : 0),
      0
    )
    if (exportedToday >= dailyLimit) {
      throw new ForbiddenError(`Daily export limit of ${dailyLimit} rows reached`)
    }
  }

  const orgSettings = await prisma.settings.findUnique({
    where: { orgId },
    select: { timezone: true },
  })
  const advancedFilters = buildAdvancedLeadWhere(
    parseAdvancedLeadFilters(url.searchParams),
    orgSettings?.timezone ?? 'Asia/Kolkata'
  )
  const maskedFields = await resolveMaskedFields(orgId, ctx.userId, ctx.role)

  // exportType forces its own stage filter — takes precedence over any
  // ambient `stage` param so "Export Deals Lost" can't silently return 0
  // rows (or the wrong rows) because a stray UI filter was still applied.
  const stageOverride =
    exportType === 'deals_lost'
      ? { stage: 'Deal Lost' }
      : exportType === 'deals_won'
        ? { stage: { in: ['Order Confirmed', 'Order Closed'] } }
        : {}

  const where = {
    orgId,
    ...buildOwnershipFilter(ctx.userId, ctx.role, ctx.department, 'leads'),
    ...(stage && !exportType && { stage }),
    ...(priority && { priority }),
    ...(sources.length && { source: { in: sources } }),
    ...(days && /^\d+$/.test(days)
      ? { createdAt: { gte: new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000) } }
      : {}),
    ...(search && {
      OR: [
        { companyName: { contains: search, mode: 'insensitive' as const } },
        { notes: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
    ...advancedFilters,
    // department composed via AND (not spread) for the same reason as the
    // leads list route — its where-fragment can itself set `stage`.
    ...(department && { AND: [getDepartmentWhereClause(department)] }),
    ...stageOverride,
  }

  const leads = await prisma.lead.findMany({
    where,
    take: Math.min(dailyLimit, HARD_EXPORT_LIMIT),
    orderBy: { createdAt: 'desc' },
    include: {
      contact: { select: { firstName: true, lastName: true, email: true, phone: true, designation: true, gstNumber: true } },
      assignedTo: { select: { fullName: true } },
      ...(exportType === 'history' && {
        timeline: { include: { events: { orderBy: { createdAt: 'asc' } } } },
      }),
    },
  })

  // Day-of-week filter applied post-query (Postgres EXTRACT(ISODOW) would be
  // cheaper for large datasets, but the export path is already capped and
  // ownership/source filters run in SQL — this keeps the query portable).
  const filteredLeads = weekdays.length
    ? leads.filter((l) => weekdays.includes(l.createdAt.getDay() === 0 ? 7 : l.createdAt.getDay()))
    : leads

  // One row per lead — nested 1:N relations (activities/quotes) collapse to
  // the totalCalls/totalMessages counters rather than expanding the export.
  // `history` is the one exception: one row per timeline event.
  const maskCol = (field: string, value: string | number | null | undefined) =>
    maskPii || maskedFields.includes(field) ? maskValue(value) : (value ?? '')

  let headers: string[]
  let rows: ExportRow[]

  if (exportType === 'history') {
    headers = ['Company', 'Event Type', 'Title', 'Description', 'Timestamp']
    rows = filteredLeads.flatMap((l: any) =>
      (l.timeline?.events ?? []).map((e: any) => [
        l.companyName,
        e.type,
        e.title,
        e.description ?? '',
        e.createdAt.toISOString(),
      ])
    )
  } else {
    const baseHeaders = [
      'Company',
      'Contact First Name',
      'Contact Last Name',
      'Email',
      'Phone',
      'Designation',
      'GST No',
      'Stage',
      'Priority',
      'Assigned To',
      'Quotation Number',
      'Quotation Value',
      'Order Value',
      'Margin %',
      'Total Calls',
      'Total Messages',
      'SLA Breached',
      'SLA Deadline',
      'Territory',
      'Service Area',
      'Pin Code',
      'Customer Segment',
      'Product Category',
      'Closing Horizon',
      'Target Closing Date',
      'Source',
      'Created At',
      'Last Activity At',
      'Notes',
    ]
    const outcomeHeaders =
      exportType === 'deals_lost'
        ? ['Deal Lost Reason', 'Deal Lost Details', 'Deal Lost Date']
        : exportType === 'deals_won'
          ? ['Deal Won Reason', 'Deal Won Details']
          : []
    headers = [...baseHeaders, ...outcomeHeaders]

    rows = filteredLeads.map((l) => {
      const base: ExportRow = [
        l.companyName,
        l.contact?.firstName ?? '',
        l.contact?.lastName ?? '',
        maskCol('email', l.contact?.email),
        maskCol('phone', l.contact?.phone),
        l.contact?.designation ?? '',
        maskCol('gstNumber', l.contact?.gstNumber),
        l.stage,
        l.priority,
        l.assignedTo?.fullName ?? '',
        l.quotationNumber ?? '',
        maskCol('quotationValue', l.quotationValue ? Number(l.quotationValue) : null),
        maskCol('orderValue', l.orderValue ? Number(l.orderValue) : null),
        maskCol('supplierMargin', l.supplierMargin ? Number(l.supplierMargin) : null),
        l.totalCalls,
        l.totalMessages,
        l.slaBreached ? 'yes' : 'no',
        l.slaDeadline ? l.slaDeadline.toISOString() : '',
        l.territory ?? '',
        l.serviceArea ?? '',
        l.pinCode ?? '',
        l.customerSegment ?? '',
        l.productCategory ?? '',
        l.closingHorizon ?? '',
        l.targetClosingDate ? l.targetClosingDate.toISOString() : '',
        l.source ?? '',
        l.createdAt.toISOString(),
        l.lastActivityAt.toISOString(),
        l.notes ?? '',
      ]
      const outcome =
        exportType === 'deals_lost'
          ? [l.dealLostReason ?? '', l.dealLostDetails ?? '', l.dealLostDate?.toISOString() ?? '']
          : exportType === 'deals_won'
            ? [l.dealWonReason ?? '', l.dealWonDetails ?? '']
            : []
      return [...base, ...outcome]
    })
  }

  if (format === 'pdf' && rows.length > PDF_ROW_CAP) {
    throw new ValidationError(
      `PDF limited to ${PDF_ROW_CAP} rows — use CSV/XLSX for larger exports (${rows.length} rows matched)`
    )
  }

  let body: string | Buffer
  let contentType: string
  let extension: string
  if (format === 'json') {
    body = toJson(headers, rows)
    contentType = 'application/json'
    extension = 'json'
  } else if (format === 'xlsx') {
    body = await toXlsx(headers, rows)
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    extension = 'xlsx'
  } else if (format === 'pdf') {
    body = await toPdf(headers, rows)
    contentType = 'application/pdf'
    extension = 'pdf'
  } else {
    body = toCsv(headers, rows)
    contentType = 'text/csv; charset=utf-8'
    extension = 'csv'
  }

  const bodyBuffer = typeof body === 'string' ? Buffer.from(body) : body
  const fileHash = createHash('sha256').update(bodyBuffer).digest('hex')

  await logAudit(orgId, ctx.userId, 'EXPORT', 'Lead', 'bulk', `${format.toUpperCase()} export`, {
    count: rows.length,
    format,
    exportType: exportType ?? 'leads',
    columns: headers,
    filters: { stage, priority, days, search, sources, weekdays, ...parseAdvancedLeadFilters(url.searchParams) },
    fileHash,
  }, ipFromRequest(req))

  return new NextResponse(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="leads-${exportType ?? 'export'}-${new Date().toISOString().slice(0, 10)}.${extension}"`,
    },
  })
})
