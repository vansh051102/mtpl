import { z } from 'zod'
import { prisma } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { LEAD_PRIORITIES, CUSTOMER_SEGMENTS } from '@/lib/validation'
import { PERMISSIONS } from '@/lib/rbac'
import { normalizeEmail, normalizePhone } from '@/lib/normalize'
import { toCsv } from '@/lib/csv'
import { successResponse, withErrorHandler, ValidationError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'

// Spreadsheet exports commonly format money as "₹1,50,000" or "$1,500.00" —
// strip currency symbols/commas/whitespace before coercing to a number.
const sanitizedNumber = z.preprocess((val) => {
  if (typeof val !== 'string') return val
  const cleaned = val.replace(/[₹$,\s]/g, '')
  return cleaned === '' ? undefined : cleaned
}, z.coerce.number().optional())

const ImportRowSchema = z.object({
  companyName: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(5),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  gstNumber: z.string().optional(),
  city: z.string().optional(),
  tag: z.string().optional(),
  assignedToEmail: z.string().email().optional(),
  quotationValue: sanitizedNumber,
  orderValue: sanitizedNumber,
  territory: z.string().optional(),
  pinCode: z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid PIN code').optional(),
  serviceArea: z.string().optional(),
  quotationNumber: z.string().optional(),
  supplierMargin: sanitizedNumber,
  customerSegment: z.enum(CUSTOMER_SEGMENTS).optional(),
})

const IMPORT_CHUNK_SIZE = 100

const DUPLICATE_STRATEGIES = ['skip', 'overwrite', 'repeat_enquiry'] as const

const ImportSchema = z.object({
  rows: z.array(ImportRowSchema).min(1).max(500),
  duplicateStrategy: z.enum(DUPLICATE_STRATEGIES).default('skip'),
})

function ipFromRequest(req: Request): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

// POST /api/v1/leads/import - Bulk import leads (CSV/XLSX parsed and column-
// mapped client-side — the wire format is always this field-keyed row shape,
// regardless of source file format or how columns were mapped).
// Contacts are upserted by normalized email; each row creates a lead with
// full SOP defaults (checklists, timeline, auto-assignment) via the shared
// creator. Rows are processed independently: failures are reported per-row
// (with a downloadable error CSV) and do not roll back successful ones.
export const POST = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const { orgId, userId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.LEADS_IMPORT)

  const body = await req.json()
  const parsed = ImportSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid import data', parsed.error.flatten())
  }
  const { duplicateStrategy } = parsed.data

  // Resolve "assign to" emails to user IDs up front (one query instead of
  // one per row). Unmatched emails just leave the lead unassigned.
  const assigneeEmails = [
    ...new Set(parsed.data.rows.map((r) => r.assignedToEmail).filter(Boolean) as string[]),
  ]
  const assignees = assigneeEmails.length
    ? await prisma.user.findMany({
        where: { orgId, email: { in: assigneeEmails }, status: 'active' },
        select: { id: true, email: true },
      })
    : []
  const assigneeIdByEmail = new Map(assignees.map((u) => [u.email, u.id]))

  let created = 0
  let updated = 0
  const errors: { row: number; message: string }[] = []
  const failedRows: Array<Record<string, string | number | undefined>> = []

  // Chunked purely for bounded, reviewable progress batches — NOT wrapped in
  // an outer $transaction. createLeadWithDefaults already opens its own
  // transaction per lead (SLA clock, SOP checklists, timeline, assignee
  // pick); nesting 100 of those inside one more transaction would hold a
  // single DB connection for the whole batch's duration, which is a bigger
  // connection-pool risk than today's per-row-independent-transaction loop
  // (see the $transaction-vs-Promise.all comment in
  // app/api/v1/leads/stats/route.ts for the same lesson elsewhere in this repo).
  const rowsWithIndex = parsed.data.rows.map((row, index) => ({ row, index }))
  for (let chunkStart = 0; chunkStart < rowsWithIndex.length; chunkStart += IMPORT_CHUNK_SIZE) {
    const chunk = rowsWithIndex.slice(chunkStart, chunkStart + IMPORT_CHUNK_SIZE)
    for (const { row, index } of chunk) {
    // Sanitize before matching — an unnormalized phone/email would silently
    // miss the dedup lookup below (@@unique constraint compares normalized
    // values from other ingestion paths, e.g. the contacts POST route).
    const email = normalizeEmail(row.email)
    const phone = normalizePhone(row.phone)
    try {
      const contact = await prisma.contact.upsert({
        where: { orgId_email: { orgId, email } },
        create: {
          orgId,
          firstName: row.firstName,
          lastName: row.lastName,
          email,
          phone,
          source: row.source || 'Other',
          gstNumber: row.gstNumber,
          city: row.city,
          tags: row.tag ? [row.tag] : [],
          createdById: userId,
        },
        update: {}, // existing contact wins; import never overwrites the contact
      })

      const result = await createLeadWithDefaults({
        orgId,
        contactId: contact.id,
        companyName: row.companyName,
        priority: row.priority,
        notes: row.notes,
        source: row.source || 'CSV Import',
        assignedToId: row.assignedToEmail ? assigneeIdByEmail.get(row.assignedToEmail) : undefined,
        createdById: userId,
        quotationValue: row.quotationValue,
        orderValue: row.orderValue,
        territory: row.territory,
        pinCode: row.pinCode,
        serviceArea: row.serviceArea,
        quotationNumber: row.quotationNumber,
        supplierMargin: row.supplierMargin,
        customerSegment: row.customerSegment,
      })

      if (!result.duplicate) {
        created++
        continue
      }

      if (duplicateStrategy === 'overwrite') {
        await prisma.lead.update({
          where: { id: result.existingLead.id },
          data: {
            companyName: row.companyName,
            priority: row.priority,
            notes: row.notes,
            source: row.source || 'CSV Import',
            ...(row.quotationValue !== undefined && { quotationValue: row.quotationValue }),
            ...(row.orderValue !== undefined && { orderValue: row.orderValue }),
            ...(row.territory !== undefined && { territory: row.territory }),
            ...(row.pinCode !== undefined && { pinCode: row.pinCode }),
            ...(row.serviceArea !== undefined && { serviceArea: row.serviceArea }),
            ...(row.quotationNumber !== undefined && { quotationNumber: row.quotationNumber }),
            ...(row.supplierMargin !== undefined && { supplierMargin: row.supplierMargin }),
            ...(row.customerSegment !== undefined && { customerSegment: row.customerSegment }),
            version: { increment: 1 },
          },
        })
        updated++
      } else if (duplicateStrategy === 'repeat_enquiry') {
        const repeat = await createLeadWithDefaults({
          orgId,
          contactId: contact.id,
          companyName: row.companyName,
          priority: row.priority,
          notes: row.notes,
          source: row.source || 'CSV Import',
          assignedToId: row.assignedToEmail ? assigneeIdByEmail.get(row.assignedToEmail) : undefined,
          createdById: userId,
          allowRepeat: true,
          sourceDetails: { repeatOf: result.existingLead.id },
          quotationValue: row.quotationValue,
          orderValue: row.orderValue,
          territory: row.territory,
          pinCode: row.pinCode,
          serviceArea: row.serviceArea,
          quotationNumber: row.quotationNumber,
          supplierMargin: row.supplierMargin,
          customerSegment: row.customerSegment,
        })
        if (!repeat.duplicate) created++
      } else {
        errors.push({
          row: index + 1,
          message: `Already exists — assigned to ${result.existingLead.assignedTo?.fullName ?? 'someone'} (${result.existingLead.stage})`,
        })
        failedRows.push({ ...row, error: 'Duplicate contact' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      errors.push({ row: index + 1, message })
      failedRows.push({ ...row, error: message })
    }
    }
  }

  const errorCsv =
    failedRows.length > 0
      ? toCsv(
          [...Object.keys(parsed.data.rows[0] ?? {}), 'error'],
          failedRows.map((r) => Object.values(r))
        )
      : null

  await logAudit(
    orgId,
    userId,
    'IMPORT',
    'Lead',
    'bulk',
    'CSV import',
    {
      attempted: parsed.data.rows.length,
      created,
      updated,
      failed: errors.length,
      duplicateStrategy,
    },
    ipFromRequest(req)
  )

  return successResponse({ created, updated, failed: errors.length, errors, errorCsv })
})
