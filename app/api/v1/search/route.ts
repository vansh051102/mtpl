import { prisma } from '@/lib/db'
import { successResponse, withErrorHandler } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'

const RESULT_LIMIT = 5
const MIN_QUERY_LENGTH = 2

export interface SearchResult {
  type: 'lead' | 'contact' | 'customer' | 'supplier' | 'purchase_request' | 'employee'
  id: string
  label: string
  href: string
}

// GET /api/v1/search?q= — fan-out across Leads, Contacts, Customers, Suppliers,
// Purchase Requests, Employees. Org-scoped, case-insensitive `contains` match
// (Prisma-parameterized — no raw SQL). Backs the Command Palette (§17) and
// SearchBar (§13).
export const GET = withErrorHandler(async (req: Request) => {
  const ctx = await validateRequest(req)
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY_LENGTH) return successResponse<SearchResult[]>([])

  const insensitiveContains = { contains: q, mode: 'insensitive' as const }

  const [leads, contacts, customers, suppliers, purchaseRequests, employees] = await Promise.all([
    prisma.lead.findMany({
      where: { orgId: ctx.orgId, isArchived: false, companyName: insensitiveContains },
      select: { id: true, companyName: true },
      take: RESULT_LIMIT,
    }),
    prisma.contact.findMany({
      where: { orgId: ctx.orgId, OR: [{ firstName: insensitiveContains }, { lastName: insensitiveContains }] },
      select: { id: true, firstName: true, lastName: true },
      take: RESULT_LIMIT,
    }),
    prisma.customer.findMany({
      where: { orgId: ctx.orgId, name: insensitiveContains },
      select: { id: true, name: true },
      take: RESULT_LIMIT,
    }),
    prisma.supplier.findMany({
      where: { orgId: ctx.orgId, name: insensitiveContains },
      select: { id: true, name: true },
      take: RESULT_LIMIT,
    }),
    prisma.purchaseRequest.findMany({
      where: { orgId: ctx.orgId, prNumber: insensitiveContains },
      select: { id: true, prNumber: true },
      take: RESULT_LIMIT,
    }),
    prisma.user.findMany({
      where: { orgId: ctx.orgId, status: 'active', fullName: insensitiveContains },
      select: { id: true, fullName: true },
      take: RESULT_LIMIT,
    }),
  ])

  const results: SearchResult[] = [
    ...leads.map((l) => ({ type: 'lead' as const, id: l.id, label: l.companyName, href: `/leads/${l.id}` })),
    ...contacts.map((c) => ({ type: 'contact' as const, id: c.id, label: `${c.firstName} ${c.lastName}`, href: `/contacts?highlight=${c.id}` })),
    ...customers.map((c) => ({ type: 'customer' as const, id: c.id, label: c.name, href: `/customers` })),
    ...suppliers.map((s) => ({ type: 'supplier' as const, id: s.id, label: s.name, href: `/purchase` })),
    ...purchaseRequests.map((pr) => ({ type: 'purchase_request' as const, id: pr.id, label: pr.prNumber, href: `/purchase` })),
    ...employees.map((e) => ({ type: 'employee' as const, id: e.id, label: e.fullName, href: `/employees/command-center` })),
  ]

  return successResponse(results)
})
