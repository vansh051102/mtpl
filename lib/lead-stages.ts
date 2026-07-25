// Pure, dependency-free lead-stage data shared by both the server workflow
// engine (lib/workflow.ts) and client components (e.g. the stage-change
// dropdown on the lead detail page). Keeping this isolated from lib/workflow.ts
// (which imports the Prisma client) means client components can import it
// without pulling a Node-only DB client into the browser bundle.

export const TERMINAL_STAGES = ['Order Closed', 'Deal Lost', 'Disqualified'] as const

/** Stages that count as a won / confirmed order (not yet fully closed). */
export const WON_STAGES = ['Order Confirmed'] as const

/** Legacy stage name kept for one-time DB migration / back-compat reads. */
export const LEGACY_CLOSED_WON = 'Closed Won'

/**
 * Stages the purchase role can see: quote handoff (Qualified, Quote Sent) plus
 * post-order procurement (Order Confirmed, Order Closed). Single source of
 * truth — used for UI tabs here and for query scoping in lib/ownership.ts.
 */
export const PURCHASE_VISIBLE_STAGES = [
  'Qualified',
  'Quote Sent',
  'Order Confirmed',
  'Order Closed',
] as const

/**
 * Same set plus the legacy alias. Use this for DB filters so historical rows
 * still stored as "Closed Won" remain visible; use PURCHASE_VISIBLE_STAGES for
 * anything user-facing, which shouldn't render a duplicate legacy tab.
 */
export const PURCHASE_QUERY_STAGES = [
  ...PURCHASE_VISIBLE_STAGES,
  LEGACY_CLOSED_WON,
] as const

export function isTerminalStage(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage) || stage === LEGACY_CLOSED_WON
}

export function isWonStage(stage: string): boolean {
  return (WON_STAGES as readonly string[]).includes(stage) || stage === LEGACY_CLOSED_WON
}

export function normalizeStageName(stage: string): string {
  return stage === LEGACY_CLOSED_WON ? 'Order Confirmed' : stage
}

// Controlled vocabulary for Deal Lost / Disqualified reasons. Disqualified and
// Deal Lost have distinct lists (a lead is disqualified early — bad fit/contact
// — vs lost late after a real opportunity). Free-text reasons are rejected so
// loss analytics stay queryable; a free-text "details" field captures specifics.

// Reasons for marking a lead DISQUALIFIED (early-funnel drop).
export const DISQUALIFIED_REASONS = [
  'Customer Unresponsive',
  'Wrong Number / Invalid Contact',
  'Customer Not Interested',
  'No Requirement',
  'Product Not Supplied',
  'Specification Not Available',
  'Quantity Not Commercially Viable',
  'Location Not Serviceable',
  'Price / Budget Mismatch',
  'Payment / Credit Terms Not Acceptable',
  'Delivery Timeline Not Feasible',
  'Non-Genuine / Rate Enquiry',
  'Competitor Enquiry',
  'Customer Purchased Elsewhere',
  'Project Cancelled',
  'Requirement Postponed',
  'Requirement Outside Scope',
  'Material Cannot Be Sourced',
  'Duplicate Lead',
  'Management Decision',
  'Returned to Lead Gen',
  'Other',
] as const

// Reasons for marking a deal LOST (late-funnel loss after a real opportunity).
export const DEAL_LOST_REASONS = [
  'Purchased Elsewhere',
  'Price Too High',
  'Price Not Accepted',
  'Project Cancelled',
  'Payment Terms Issue',
  'Payment Terms Not Accepted',
  'Delivery Timeline Issue',
  'Delivery Timeline Not Accepted',
  'No Response',
  'Customer Not Responding',
  'Dormant',
  'Requirement Postponed',
  'Budget Issue',
  'Budget Constraints',
  'Credit Requirement',
  'Credit Facility Not Approved',
  'Product Not Suitable',
  'Product Specification Changed',
  'Quantity Reduced / Not Commercially Viable',
  'Customer Purchased Elsewhere',
  'Existing Supplier Retained',
  'Competitor Offered Better Terms',
  'Material Cannot Be Sourced',
  'Production / Supply Constraints',
  'Transportation / Freight Issue',
  'Commercial Terms Not Accepted',
  'Management Decision',
  'Customer Withdrew Enquiry',
  'Other',
] as const

// Returns the controlled reason list for a terminal (loss) stage, or [] for
// any non-loss stage.
export function reasonsForStage(stage: string): readonly string[] {
  if (stage === 'Disqualified') return DISQUALIFIED_REASONS
  if (stage === 'Deal Lost') return DEAL_LOST_REASONS
  return []
}

// True if `reason` is valid for moving a lead to the given loss stage.
export function isValidReason(stage: string, reason: string): boolean {
  return reasonsForStage(stage).includes(reason)
}

// Back-compat: accepts a reason valid for either loss stage.
export function isValidDealLostReason(reason: string): boolean {
  return (
    (DEAL_LOST_REASONS as readonly string[]).includes(reason) ||
    (DISQUALIFIED_REASONS as readonly string[]).includes(reason)
  )
}

// Call outcomes for the "Log a Call" action. Only "Connected" counts as the
// customer picking up; everything else maps to contactOutcome="not_received".
export const CALL_OUTCOMES = [
  'Connected',
  'No Answer',
  'Busy',
  'Switched Off',
  'Not Reachable',
  'Wrong Number',
  'Call Back Requested',
  'DND / Do Not Call',
] as const

// Maps a call outcome to the lead.contactOutcome value that drives the
// marketing Connected / Not Received tabs.
export function contactOutcomeForCall(outcome: string): 'connected' | 'not_received' {
  return outcome === 'Connected' ? 'connected' : 'not_received'
}

// Channels for the "Log a Message" action.
export const MESSAGE_CHANNELS = ['WhatsApp', 'SMS', 'Email'] as const

// All workflow stages in display order (Sales Order Management + post-order).
export const ALL_STAGES = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Quote Sent',
  'Order Confirmed',
  'Order Closed',
  'Deal Lost',
  'Disqualified',
] as const

// All other known stages, unrestricted by sequence — used only as a fallback
// before role/user context has loaded. Prefer nextValidStages() once it has.
// Access itself is role-scoped via canAccessLead() / buildOwnershipFilter().
export function otherStages(currentStage: string): string[] {
  const current = normalizeStageName(currentStage)
  return ALL_STAGES.filter((s) => s !== current)
}

// Sales SOP: the pipeline is a sequence, not a free-for-all. Forward moves
// follow New Lead → Contacted → Qualified → Quote Sent → Order Confirmed →
// Order Closed. Deal Lost only exists past Quote Sent (before that there's no
// real deal to lose). Disqualified is reachable earlier (New Lead, Contacted)
// as the expected early-funnel exit, and later (Qualified, Quote Sent) as a
// rarer, flagged exception — see FLAGGED_DISQUALIFY_FROM. The remaining
// entries are reopen/handback paths already relied on elsewhere (purchase
// handing a quote back to Qualified, reopening a closed order, resetting a
// terminal stage back to New Lead).
export const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  'New Lead': ['Contacted', 'Disqualified'],
  Contacted: ['Qualified', 'Disqualified'],
  Qualified: ['Quote Sent', 'Disqualified'],
  'Quote Sent': ['Qualified', 'Order Confirmed', 'Deal Lost', 'Disqualified'],
  'Order Confirmed': ['Order Closed', 'Deal Lost'],
  'Order Closed': ['Order Confirmed'],
  'Deal Lost': ['New Lead'],
  Disqualified: ['New Lead'],
}

// Stages a lead disqualified from are the rare, flagged exception — real
// engagement (a requirement gathered, or a quote sent) already happened, so
// disqualifying here wastes the salesperson's and the customer's time versus
// catching it at New Lead/Contacted. Not blocked, just surfaced.
export const FLAGGED_DISQUALIFY_FROM = ['Qualified', 'Quote Sent'] as const

export function isFlaggedDisqualify(fromStage: string, toStage: string): boolean {
  if (normalizeStageName(toStage) !== 'Disqualified') return false
  return (FLAGGED_DISQUALIFY_FROM as readonly string[]).includes(normalizeStageName(fromStage))
}

/**
 * Did this move skip the SOP sequence? Every role is allowed to do it — real
 * deals go sideways (a quote gets disqualified, a closed order comes back as
 * lost, a walk-in is qualified on arrival). We don't block those, we record
 * them with a reason so an admin can review why the SOP was bypassed.
 */
export function isOutOfSequence(fromStage: string, toStage: string): boolean {
  const from = normalizeStageName(fromStage)
  const to = normalizeStageName(toStage)
  if (from === to) return false
  return !(ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

// Stages a lead in `currentStage` may legally move to next, per the SOP above.
export function nextValidStages(currentStage: string): string[] {
  const current = normalizeStageName(currentStage)
  return [...(ALLOWED_TRANSITIONS[current] ?? [])]
}

// Returns the stage tab labels a given role should see in the leads list nav.
// Purchase: quote handoff + post-order procurement stages.
// Marketing: top of funnel through Qualified (handover to Sales).
export function visibleStagesForRole(role: string): string[] {
  if (role === 'purchase') {
    return [...PURCHASE_VISIBLE_STAGES]
  }
  if (role.startsWith('marketing')) {
    return ['New Lead', 'Contacted', 'Qualified', 'Disqualified']
  }
  return [...ALL_STAGES]
}

// ============================================================================
// LEAD LIST TABS (role-aware)
// ============================================================================
// A tab is a saved filter: a stage plus (optionally) a contact outcome.
// Marketing splits "Contacted" into "Connected" (call picked up) and
// "Not Received" (no answer yet) — driven by Lead.contactOutcome, which is
// set automatically from logged call outcomes.

export interface LeadTab {
  label: string
  stage?: string // undefined = All
  contactOutcome?: 'connected' | 'not_received'
}

export function leadTabsForRole(role: string): LeadTab[] {
  if (role.startsWith('marketing')) {
    return [
      { label: 'All' },
      { label: 'New Lead', stage: 'New Lead' },
      { label: 'Connected', stage: 'Contacted', contactOutcome: 'connected' },
      { label: 'Not Received', stage: 'Contacted', contactOutcome: 'not_received' },
      { label: 'Qualified', stage: 'Qualified' },
      { label: 'Disqualified', stage: 'Disqualified' },
    ]
  }
  return [{ label: 'All' }, ...visibleStagesForRole(role).map((s) => ({ label: s, stage: s }))]
}

/** Roles that receive marketing → sales handover at Qualified. */
export const SALES_HANDOVER_ROLES = [
  'sales_manager',
  'sales_executive',
  'sales_purchase',
] as const
