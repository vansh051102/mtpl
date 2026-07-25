import type { AdvancedLeadFilters } from './leads-cache'

/** Sentinel substituted with the current user's id when a preset is applied
 *  (lib/lead-smart-views.ts has no access to auth state — the caller does). */
export const CURRENT_USER_SENTINEL = '__ME__'

export interface SmartViewFilters {
  stage?: string
  days?: string
  advanced: Partial<AdvancedLeadFilters>
}

export interface SmartView {
  id: string
  label: string
  filters: SmartViewFilters
}

// Hardcoded presets — no personalization requested, so no SavedView model/
// migration/CRUD routes. Every field here is an existing, already-validated
// filter param (see app/api/v1/leads/route.ts, lib/lead-filters.ts) — no new
// backend surface beyond the status/department/assignedToId/slaBreached/
// callsCountMax additions made alongside this file for the same reason.
export const SMART_VIEWS: SmartView[] = [
  {
    id: 'my-work-today',
    label: 'My Work Today',
    // No per-lead "next follow-up" field exists yet (only per-Activity
    // scheduledFor) — simplified to "my open leads" rather than a true
    // due-today query. Revisit if/when a lead-level follow-up field lands.
    filters: { advanced: { assignedToId: CURRENT_USER_SENTINEL, status: 'open' } },
  },
  {
    id: 'sla-breached',
    label: 'SLA Breached',
    filters: { advanced: { slaBreached: 'true' } },
  },
  {
    id: 'first-call-pending',
    label: 'First Call Pending',
    filters: { advanced: { callsCountMin: '0', callsCountMax: '0' } },
  },
  {
    id: 'waiting-on-customer',
    label: 'Waiting on Customer',
    filters: { stage: 'Quote Sent', advanced: { inactivityDays: '2' } },
  },
  {
    id: 'high-margin',
    label: 'High-Margin Opportunities',
    // Sane default, not org-configurable yet — adjustable via the advanced
    // panel's own marginMin input after applying this preset.
    filters: { advanced: { marginMin: '20' } },
  },
  {
    id: 'stuck-idle',
    label: 'Stuck / Idle Leads',
    filters: { advanced: { inactivityDays: '14', status: 'open' } },
  },
  {
    id: 'recently-won',
    label: 'Recently Won',
    filters: { stage: 'Order Confirmed', days: '30', advanced: {} },
  },
  {
    id: 'recently-lost',
    label: 'Recently Lost',
    filters: { stage: 'Deal Lost', days: '30', advanced: {} },
  },
]
