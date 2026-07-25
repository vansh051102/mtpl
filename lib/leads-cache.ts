import { api } from '@/lib/api-client'
import type { LeadRow } from '@/components/leads-table'

export interface LeadListResult {
  data: LeadRow[]
  total: number
  totalPages: number
  fetchedAt: number
}

/** Phase C advanced filters — kept as a single sub-object so the cache key
 *  and URLSearchParams builders don't need a new line per field. */
export interface AdvancedLeadFilters {
  quotationValueMin?: string
  quotationValueMax?: string
  orderValueMin?: string
  orderValueMax?: string
  marginMin?: string
  marginMax?: string
  quotationNumber?: string
  closingHorizon?: string
  closingFrom?: string
  closingTo?: string
  territory?: string
  serviceArea?: string
  pinCode?: string
  callsCountMin?: string
  callsCountMax?: string
  messagesCountMin?: string
  inactivityDays?: string
  productCategory?: string
  customerSegment?: string
  // Basic filters already supported server-side (app/api/v1/leads/route.ts)
  // but not previously exposed on the frontend query — added here (rather
  // than as new top-level LeadListQuery fields + cache-key lines) so they
  // ride the existing generic serialization in leadCacheKey/buildParams.
  status?: string
  department?: string
  assignedToId?: string
  slaBreached?: string
}

export const EMPTY_ADVANCED_FILTERS: AdvancedLeadFilters = {}

export interface LeadListQuery {
  stage?: string
  contactOutcome?: string
  priority?: string
  days?: string
  fromDate?: string
  toDate?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: string
  view?: 'list' | 'kanban'
  advanced?: AdvancedLeadFilters
}

type Listener = () => void

const cache = new Map<string, LeadListResult>()
const inflight = new Map<string, Promise<LeadListResult>>()
const listeners = new Set<Listener>()

export function leadCacheKey(q: LeadListQuery): string {
  const a = q.advanced ?? EMPTY_ADVANCED_FILTERS
  return [
    q.stage ?? '',
    q.contactOutcome ?? '',
    q.priority ?? '',
    q.days ?? '',
    q.fromDate ?? '',
    q.toDate ?? '',
    q.search ?? '',
    String(q.page ?? 1),
    String(q.pageSize ?? 50),
    q.sortBy ?? 'createdAt',
    q.sortDir ?? 'desc',
    q.view ?? 'list',
    Object.keys(a)
      .sort()
      .map((k) => `${k}=${a[k as keyof AdvancedLeadFilters] ?? ''}`)
      .join(','),
  ].join('|')
}

function notify() {
  listeners.forEach((l) => l())
}

export function subscribeLeadsCache(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCachedLeads(q: LeadListQuery): LeadListResult | null {
  return cache.get(leadCacheKey(q)) ?? null
}

export function setCachedLeads(q: LeadListQuery, result: LeadListResult) {
  cache.set(leadCacheKey(q), result)
  notify()
}

function buildParams(q: LeadListQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (q.stage) params.set('stage', q.stage)
  if (q.contactOutcome) params.set('contactOutcome', q.contactOutcome)
  if (q.priority) params.set('priority', q.priority)
  if (q.days) params.set('days', q.days)
  if (q.fromDate) params.set('from', q.fromDate)
  if (q.toDate) params.set('to', q.toDate)
  if (q.search) params.set('search', q.search)
  params.set('page', String(q.page ?? 1))
  params.set('limit', q.view === 'kanban' ? '100' : String(q.pageSize ?? 50))
  params.set('sortBy', q.sortBy ?? 'createdAt')
  params.set('sortDir', q.sortDir ?? 'desc')
  if (q.advanced) {
    for (const [key, value] of Object.entries(q.advanced)) {
      if (value) params.set(key, value)
    }
  }
  return params
}

export async function fetchLeads(q: LeadListQuery, opts?: { force?: boolean }): Promise<LeadListResult> {
  const key = leadCacheKey(q)
  if (!opts?.force) {
    const hit = cache.get(key)
    if (hit) return hit
    const pending = inflight.get(key)
    if (pending) return pending
  }

  const promise = (async () => {
    const res = await api.get<LeadRow[]>(`/leads?${buildParams(q).toString()}`)
    const result: LeadListResult = {
      data: res.data ?? [],
      total: res.pagination?.total ?? 0,
      totalPages: res.pagination?.totalPages ?? 1,
      fetchedAt: Date.now(),
    }
    cache.set(key, result)
    notify()
    return result
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise)
  return promise
}

/** Prefetch disabled — parallel stage fetches saturated the API and blocked the drawer. */
export async function prefetchLeadTabs(
  _tabs: unknown[],
  _base: Omit<LeadListQuery, 'stage' | 'contactOutcome' | 'page'>,
  _opts?: { force?: boolean }
) {
  return
}
