import type { Prisma } from '@prisma/client'

// Derived, display-only grouping over the existing (unchanged) stage
// machine — NOT a real stage/workflow. Nothing here feeds SLA rules, SOP
// checklists, or dashboard KPI snapshots, which all still key off the exact
// stage strings in lib/lead-stages.ts.
export const DEPARTMENTS = ['Marketing', 'Sales', 'Purchase', 'Quotation', 'Order', 'Closed'] as const
export type Department = (typeof DEPARTMENTS)[number]

// PurchaseRequest.status is created as 'pending' (app/api/v1/leads/[id]/purchase-requests/route.ts
// POST) and transitions via app/api/v1/purchase-requests/[id]/route.ts PUT
// through 'sent_to_supplier' -> 'received' -> 'approved'. Only 'pending'
// counts as "open" here — once purchase moves it forward, the lead stops
// being classified into the Purchase department. Kept as an array, not a
// scattered literal, so adding another "still open" status is a one-line change.
export const OPEN_PURCHASE_REQUEST_STATUSES = ['pending']

interface DepartmentLeadLike {
  stage: string
  purchaseRequests?: { status: string }[]
}

/** UI display/badge only — the actual list is already filtered server-side
 *  by getDepartmentWhereClause() when a department filter is applied. */
export function getLeadDepartment(lead: DepartmentLeadLike): Department {
  const hasOpenPurchaseRequest = (lead.purchaseRequests ?? []).some((pr) =>
    OPEN_PURCHASE_REQUEST_STATUSES.includes(pr.status)
  )

  if (hasOpenPurchaseRequest) return 'Purchase'

  switch (lead.stage) {
    case 'New Lead':
    case 'Contacted':
      return 'Marketing'
    case 'Qualified':
      return 'Sales'
    case 'Quote Sent':
      return 'Quotation'
    case 'Order Confirmed':
    case 'Order Closed':
      return 'Order'
    case 'Deal Lost':
    case 'Disqualified':
      return 'Closed'
    default:
      return 'Sales'
  }
}

/** Server-side Prisma where-fragment for the `department` filter param —
 *  reused by both the leads list route and export route so filtering and
 *  the display badge (getLeadDepartment) never drift apart. */
export function getDepartmentWhereClause(department: string): Prisma.LeadWhereInput {
  switch (department) {
    case 'Marketing':
      return { stage: { in: ['New Lead', 'Contacted'] } }
    case 'Sales':
      return {
        stage: 'Qualified',
        purchaseRequests: { none: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } } },
      }
    case 'Purchase':
      return { purchaseRequests: { some: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } } } }
    case 'Quotation':
      // Excludes leads with an open PurchaseRequest, same as Sales — a
      // Quote Sent lead whose badge shows Purchase (getLeadDepartment
      // checks the open-PR case first) must not also match here.
      return {
        stage: 'Quote Sent',
        purchaseRequests: { none: { status: { in: OPEN_PURCHASE_REQUEST_STATUSES } } },
      }
    case 'Order':
      return { stage: { in: ['Order Confirmed', 'Order Closed'] } }
    case 'Closed':
      return { stage: { in: ['Deal Lost', 'Disqualified'] } }
    default:
      return {}
  }
}
