'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  Download,
  LayoutGrid,
  List,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { api, ApiError } from '@/lib/api-client'
import { toFormErrors } from '@/lib/form-errors'
import { LeadsTable, type LeadRow, type OrgUser, type SortBy, type SortDir } from '@/components/leads-table'
import { LeadsLoadingState } from '@/components/leads-loading'
import { LeadsKanban } from '@/components/leads-kanban'
import { LeadsImportModal } from '@/components/leads-import-modal'
import { AssignmentRulesModal } from '@/components/assignment-rules-modal'
import { Button } from '@/components/ui/button'
import { MetricCard } from '@/components/ui/metric-card'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { NewLeadForm } from '@/components/new-lead-form'
import { useCurrentUser } from '@/lib/use-current-user'
import { PermissionGate } from '@/components/permission-gate'
import { LEAD_PRIORITIES, CUSTOMER_SEGMENTS, PRODUCT_CATEGORIES } from '@/lib/validation'
import { leadTabsForRole } from '@/lib/lead-stages'
import { SMART_VIEWS, CURRENT_USER_SENTINEL } from '@/lib/lead-smart-views'
import { cn } from '@/lib/utils'
import {
  fetchLeads,
  getCachedLeads,
  type LeadListQuery,
  type AdvancedLeadFilters,
} from '@/lib/leads-cache'
import { useLeadsLive } from '@/lib/use-leads-live'

const CACHE_FRESH_MS = 20_000

const DAY_FILTERS = [
  { label: 'All time', value: '' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '4 months', value: '120' },
]

const LEAD_SOURCES = ['Website', 'LinkedIn', 'Referral', 'Email', 'Phone', 'Other']

const INACTIVITY_PRESETS = [
  { label: '0–1 day', value: '1' },
  { label: '2–3 days', value: '3' },
  { label: '4–7 days', value: '7' },
  { label: '1–2 weeks', value: '14' },
  { label: '15–30 days', value: '30' },
  { label: '30–60 days', value: '60' },
  { label: '90+ days', value: '90' },
]

const DENSITY_PRESETS = [
  { label: 'Never contacted', value: '0' },
  { label: 'First call made', value: '1' },
  { label: 'Multiple interactions', value: '2' },
]

const DATE_RANGE_PRESETS = [
  { label: 'Today', getRange: () => rangeFromDaysAgo(0) },
  { label: 'Yesterday', getRange: () => rangeFromDaysAgo(1, 1) },
  { label: 'This month', getRange: () => rangeFromMonthStart(0) },
  { label: 'Last month', getRange: () => rangeFromMonthStart(1, 1) },
  { label: 'This quarter', getRange: () => rangeFromQuarterStart() },
] as const

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Inclusive day range starting `startDaysAgo` days back, ending `endDaysAgo` days back. */
function rangeFromDaysAgo(endDaysAgo: number, startDaysAgo = endDaysAgo): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now)
  from.setDate(now.getDate() - startDaysAgo)
  const to = new Date(now)
  to.setDate(now.getDate() - endDaysAgo)
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

/** monthsAgoStart/monthsAgoEnd: 0 = current month. 1,1 = last month only. */
function rangeFromMonthStart(monthsAgoStart: number, monthsAgoEnd = 0): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - monthsAgoStart, 1)
  const to = new Date(now.getFullYear(), now.getMonth() - monthsAgoEnd + 1, 0)
  return { from: toDateInputValue(from), to: toDateInputValue(to) }
}

function rangeFromQuarterStart(): { from: string; to: string } {
  const now = new Date()
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  const from = new Date(now.getFullYear(), quarterStartMonth, 1)
  return { from: toDateInputValue(from), to: toDateInputValue(now) }
}
const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

interface LeadStats {
  total: number
  open: number
  hot: number
  wonThisMonth: number
  slaBreached: number
  byStage: Record<string, number>
  contactOutcome?: { connected: number; notReceived: number }
}

export default function LeadsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const me = useCurrentUser()
  const role = me?.role ?? 'admin'
  const leadTabs = useMemo(() => leadTabsForRole(role), [role])
  const isMarketingRole = role === 'marketing_manager' || role === 'marketing_executive'

  // Admin-configurable — Settings.moduleAccess['lead_gen_won_lost_views'] hides
  // the Recently Won/Recently Lost smart-view chips for marketing roles.
  const [wonLostViewsEnabled, setWonLostViewsEnabled] = useState(true)
  useEffect(() => {
    if (!isMarketingRole) return
    api
      .get<{ moduleAccess?: Record<string, boolean> }>('/settings')
      .then((res) => setWonLostViewsEnabled(res.data?.moduleAccess?.lead_gen_won_lost_views ?? false))
      .catch(() => setWonLostViewsEnabled(false))
  }, [isMarketingRole])
  const visibleSmartViews = isMarketingRole
    ? SMART_VIEWS.filter((v) => wonLostViewsEnabled || (v.id !== 'recently-won' && v.id !== 'recently-lost'))
    : SMART_VIEWS

  const [initialized, setInitialized] = useState(false)
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [showNewLead, setShowNewLead] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExportOptions, setShowExportOptions] = useState(false)
  const [exportSources, setExportSources] = useState<Set<string>>(new Set())
  const [exportWeekdays, setExportWeekdays] = useState<Set<number>>(new Set())
  const [showRules, setShowRules] = useState(false)
  const [showCustomRange, setShowCustomRange] = useState(false)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [users, setUsers] = useState<OrgUser[]>([])
  const [stats, setStats] = useState<LeadStats | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [stage, setStage] = useState('')
  const [contactOutcome, setContactOutcome] = useState('')
  const [priority, setPriority] = useState('')
  const [days, setDays] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  // Phase C advanced filters — kept as one object (not persisted to the URL/
  // sessionStorage like the core filters above, to keep this diff bounded;
  // they reset on reload same as a fresh visit would).
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedLeadFilters>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveEpoch, setLiveEpoch] = useState(0)
  const appliedLiveEpoch = useRef(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [isPending, startTransition] = useTransition()

  /** Soft revalidate current + re-prefetch tabs — never blanks the UI. */
  const softRefresh = useCallback(() => {
    setLiveEpoch((k) => k + 1)
  }, [])
  const refresh = softRefresh
  useLeadsLive(softRefresh)

  const STORAGE_KEY = 'leads-filters'

  const listQuery: LeadListQuery = useMemo(
    () => ({
      stage,
      contactOutcome,
      priority,
      days,
      fromDate,
      toDate,
      search,
      page,
      pageSize,
      sortBy,
      sortDir,
      view,
      advanced: advancedFilters,
    }),
    [
      stage,
      contactOutcome,
      priority,
      days,
      fromDate,
      toDate,
      search,
      page,
      pageSize,
      sortBy,
      sortDir,
      view,
      advancedFilters,
    ]
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const hasUrlParams = [...params.keys()].length > 0

    if (hasUrlParams) {
      if (params.get('stage')) setStage(params.get('stage')!)
      if (params.get('contactOutcome')) setContactOutcome(params.get('contactOutcome')!)
      if (params.get('priority')) setPriority(params.get('priority')!)
      if (params.get('days')) setDays(params.get('days')!)
      if (params.get('from')) setFromDate(params.get('from')!)
      if (params.get('to')) setToDate(params.get('to')!)
      if (params.get('search')) setSearch(params.get('search')!)
      if (params.get('sortBy')) setSortBy(params.get('sortBy') as SortBy)
      if (params.get('sortDir')) setSortDir(params.get('sortDir') as SortDir)
      if (params.get('view')) setView(params.get('view') as 'list' | 'kanban')
      if (params.get('limit')) setPageSize(Number(params.get('limit')) || 50)
      const p = params.get('page')
      if (p && /^\d+$/.test(p)) setPage(Number(p))
    } else {
      try {
        const cached = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}')
        if (cached.stage) setStage(cached.stage)
        if (cached.contactOutcome) setContactOutcome(cached.contactOutcome)
        if (cached.priority) setPriority(cached.priority)
        if (cached.days) setDays(cached.days)
        if (cached.fromDate) setFromDate(cached.fromDate)
        if (cached.toDate) setToDate(cached.toDate)
        if (cached.search) setSearch(cached.search)
        if (cached.sortBy) setSortBy(cached.sortBy)
        if (cached.sortDir) setSortDir(cached.sortDir)
        if (cached.view) setView(cached.view)
        if (cached.page) setPage(cached.page)
        if (cached.pageSize) setPageSize(cached.pageSize)
      } catch {
        /* ignore */
      }
    }
    setInitialized(true)
  }, [])

  useEffect(() => {
    if (!initialized) return
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (contactOutcome) params.set('contactOutcome', contactOutcome)
    if (priority) params.set('priority', priority)
    if (days) params.set('days', days)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (search) params.set('search', search)
    if (page > 1) params.set('page', String(page))
    if (pageSize !== 50) params.set('limit', String(pageSize))
    if (sortBy !== 'createdAt') params.set('sortBy', sortBy)
    if (sortDir !== 'desc') params.set('sortDir', sortDir)
    if (view !== 'list') params.set('view', view)
    const qs = params.toString()
    router.replace(`/leads${qs ? `?${qs}` : ''}`, { scroll: false })

    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          stage,
          contactOutcome,
          priority,
          days,
          fromDate,
          toDate,
          search,
          page,
          pageSize,
          sortBy,
          sortDir,
          view,
        })
      )
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stage,
    contactOutcome,
    priority,
    days,
    fromDate,
    toDate,
    search,
    page,
    pageSize,
    sortBy,
    sortDir,
    view,
    initialized,
  ])

  useEffect(() => {
    api
      .get<OrgUser[]>('/users')
      .then((res) => setUsers(res.data ?? []))
      .catch(() => setUsers([]))
  }, [])

  useEffect(() => {
    api
      .get<LeadStats>('/leads/stats')
      .then((res) => setStats(res.data ?? null))
      .catch(() => setStats(null))
  }, [liveEpoch])

  function buildFilterParams(): URLSearchParams {
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (contactOutcome) params.set('contactOutcome', contactOutcome)
    if (priority) params.set('priority', priority)
    if (days) params.set('days', days)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)
    if (search) params.set('search', search)
    for (const [key, value] of Object.entries(advancedFilters)) {
      if (value) params.set(key, value)
    }
    return params
  }

  // Load only the active tab/filter. Prefetching every stage in parallel was
  // saturating middleware session lookups and keeping the UI on "Loading…".
  useEffect(() => {
    if (!initialized) return
    let cancelled = false

    async function load() {
      const cached = getCachedLeads(listQuery)
      const mustRevalidate = liveEpoch > appliedLiveEpoch.current
      // Instant paint from cache — never flash "Loading…" on tab switch.
      if (cached) {
        startTransition(() => {
          setLeads(cached.data)
          setTotal(cached.total)
          setTotalPages(cached.totalPages)
          setSelected(new Set())
          setLoading(false)
          setError(null)
        })
        const fresh = Date.now() - cached.fetchedAt < CACHE_FRESH_MS
        if (fresh && !mustRevalidate) {
          appliedLiveEpoch.current = liveEpoch
          return
        }
      } else {
        setLoading(true)
      }

      try {
        const result = await fetchLeads(listQuery, {
          force: mustRevalidate || !cached,
        })
        if (cancelled) return
        setLeads(result.data)
        setTotalPages(result.totalPages)
        setTotal(result.total)
        setError(null)
        appliedLiveEpoch.current = liveEpoch
      } catch (err) {
        if (cancelled) return
        if (!cached) {
          setError(err instanceof ApiError ? err.message : 'Failed to load leads')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const debounce = setTimeout(load, search ? 300 : 0)
    return () => {
      cancelled = true
      clearTimeout(debounce)
    }
  }, [initialized, listQuery, liveEpoch, search, startTransition])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '/' ) {
        e.preventDefault()
        document.getElementById('lead-search')?.focus()
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setShowNewLead(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [activeSmartView, setActiveSmartView] = useState<string | null>(null)

  function applySmartView(view: (typeof SMART_VIEWS)[number]) {
    setPage(1)
    setActiveSmartView((v) => (v === view.id ? null : view.id))
    if (activeSmartView === view.id) {
      // Toggle off — clear back to no filters rather than leaving a stale combo.
      setStage('')
      setDays('')
      setAdvancedFilters({})
      return
    }
    setStage(view.filters.stage ?? '')
    setDays(view.filters.days ?? '')
    setContactOutcome('')
    const resolved = { ...view.filters.advanced }
    if (resolved.assignedToId === CURRENT_USER_SENTINEL) {
      resolved.assignedToId = me?.id
    }
    setAdvancedFilters(resolved)
  }

  /** Master reset — wipes every filter, then re-applies "My Work Today" as the
   *  standard baseline view (not a blank slate) since that's the default
   *  operational view this team works from. */
  function resetFilters() {
    setPage(1)
    setPriority('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setSortBy('createdAt')
    setSortDir('desc')

    const myWorkToday = SMART_VIEWS.find((v) => v.id === 'my-work-today')
    if (!myWorkToday) {
      setStage('')
      setDays('')
      setContactOutcome('')
      setAdvancedFilters({})
      setActiveSmartView(null)
      return
    }
    setStage(myWorkToday.filters.stage ?? '')
    setDays(myWorkToday.filters.days ?? '')
    setContactOutcome('')
    const resolved = { ...myWorkToday.filters.advanced }
    if (resolved.assignedToId === CURRENT_USER_SENTINEL) {
      resolved.assignedToId = me?.id
    }
    setAdvancedFilters(resolved)
    setActiveSmartView(myWorkToday.id)
  }

  function handleSort(column: SortBy) {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir(column === 'companyName' ? 'asc' : 'desc')
    }
  }

  function handleExport() {
    const params = buildFilterParams()
    exportSources.forEach((s) => params.append('source', s))
    exportWeekdays.forEach((d) => params.append('weekday', String(d)))
    window.location.href = `/api/v1/leads/export?${params.toString()}`
    setShowExportOptions(false)
  }

  function toggleExportSource(source: string) {
    setExportSources((prev) => {
      const next = new Set(prev)
      next.has(source) ? next.delete(source) : next.add(source)
      return next
    })
  }

  function toggleExportWeekday(day: number) {
    setExportWeekdays((prev) => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  async function loadMore() {
    if (page >= totalPages || loadingMore) return
    setLoadingMore(true)
    const next = page + 1
    try {
      const result = await fetchLeads({ ...listQuery, page: next }, { force: true })
      setLeads((prev) => [...prev, ...result.data])
      setPage(next)
      setTotalPages(result.totalPages)
    } catch (err) {
      toast(toFormErrors(err, 'Failed to load more').message, 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))))
  }

  async function bulkRun(fn: (id: string) => Promise<unknown>, successMsg: string) {
    setBulkBusy(true)
    const ids = Array.from(selected)
    const results = await Promise.allSettled(ids.map(fn))
    const failed = results.filter((r) => r.status === 'rejected').length
    setBulkBusy(false)
    if (failed > 0) {
      const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
      toast(
        `${failed}/${ids.length} failed: ${toFormErrors(firstError.reason, 'Update failed').message}`,
        'error'
      )
    } else {
      toast(successMsg)
    }
    refresh()
  }

  const customActive = Boolean(fromDate || toDate)

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Lead insights" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Total leads"
          helper="leads visible to you in this workspace"
          value={stats?.total ?? '—'}
        />
        <MetricCard
          label="Open leads"
          helper="leads not assigned yet"
          value={stats?.open ?? '—'}
        />
        <MetricCard
          label="Hot or Urgent"
          helper="needs quick follow-up"
          value={stats?.hot ?? '—'}
        />
        <MetricCard
          label="Won this month"
          helper="all leads assigned"
          value={stats?.wonThisMonth ?? '—'}
        />
      </section>

      <section
        aria-label="Lead workspace controls"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 shadow-soft"
      >
        <div className="flex rounded-md border border-border" role="group" aria-label="Lead view">
          <button
            type="button"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-l-md',
              view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Kanban view"
            aria-pressed={view === 'kanban'}
            onClick={() => setView('kanban')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-r-md border-l border-border',
              view === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5">
          {DAY_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => {
                setPage(1)
                setDays(f.value)
                setFromDate('')
                setToDate('')
                setShowCustomRange(false)
              }}
              className={cn(
                'crm-chip',
                days === f.value && !customActive ? 'crm-chip-active' : 'crm-chip-idle'
              )}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCustomRange((v) => !v)}
            className={cn('crm-chip', customActive || showCustomRange ? 'crm-chip-active' : 'crm-chip-idle')}
          >
            Custom range
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className={cn(
              'crm-chip',
              showAdvanced || Object.values(advancedFilters).some(Boolean) ? 'crm-chip-active' : 'crm-chip-idle'
            )}
          >
            More filters
          </button>
          <button type="button" onClick={resetFilters} className="crm-chip crm-chip-idle">
            Reset filters
          </button>
          <select
            value={sortBy}
            onChange={(e) => {
              setPage(1)
              setSortBy(e.target.value as SortBy)
              setSortDir('desc')
            }}
            aria-label="Sort by"
            className="crm-input h-8 w-auto"
          >
            <option value="createdAt">Newest</option>
            <option value="lastActivityAt">Most recently active</option>
            <option value="quotationValue">Highest quotation value</option>
            <option value="orderValue">Highest order value</option>
            <option value="supplierMargin">Highest margin</option>
            <option value="totalCalls">Most calls</option>
            <option value="totalMessages">Most messages</option>
          </select>
        </div>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="lead-search"
            value={search}
            onChange={(e) => {
              setPage(1)
              setSearch(e.target.value)
            }}
            placeholder="Search leads"
            aria-label="Search leads"
            className="crm-input w-full pl-8"
          />
        </div>

        <select
          value={priority}
          onChange={(e) => {
            setPage(1)
            setPriority(e.target.value)
          }}
          aria-label="Filter by priority"
          className="crm-input w-auto"
        >
          <option value="">All priorities</option>
          {LEAD_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="outline" size="sm">
              Import / Export
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-50 min-w-[10rem] rounded-md border border-border bg-card p-1 shadow-modal"
            >
              <PermissionGate permission="leads:import">
                <DropdownMenu.Item
                  onSelect={() => setShowImport(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import
                </DropdownMenu.Item>
              </PermissionGate>
              <PermissionGate permission="leads:export">
                <DropdownMenu.Item
                  onSelect={() => setShowExportOptions(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export
                </DropdownMenu.Item>
              </PermissionGate>
              <PermissionGate permission="settings:edit">
                <DropdownMenu.Item
                  onSelect={() => setShowRules(true)}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted"
                >
                  Assignment rules
                </DropdownMenu.Item>
              </PermissionGate>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <PermissionGate permission="leads:create">
          <Button size="sm" onClick={() => setShowNewLead(true)}>
            <Plus className="h-4 w-4" />
            New lead
          </Button>
        </PermissionGate>
      </section>

      {showCustomRange && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <label className="text-sm text-muted-foreground" htmlFor="lead-from">
            From
          </label>
          <input
            id="lead-from"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setPage(1)
              setDays('')
              setFromDate(e.target.value)
            }}
            className="crm-input"
          />
          <label className="text-sm text-muted-foreground" htmlFor="lead-to">
            To
          </label>
          <input
            id="lead-to"
            type="date"
            value={toDate}
            onChange={(e) => {
              setPage(1)
              setDays('')
              setToDate(e.target.value)
            }}
            className="crm-input"
          />
        </div>
      )}

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-4">
          {(
            [
              ['quotationValueMin', 'Quotation value ≥'],
              ['quotationValueMax', 'Quotation value ≤'],
              ['orderValueMin', 'Order value ≥'],
              ['orderValueMax', 'Order value ≤'],
              ['marginMin', 'Margin % ≥'],
              ['marginMax', 'Margin % ≤'],
              ['callsCountMin', 'Calls ≥'],
              ['messagesCountMin', 'Messages ≥'],
              ['inactivityDays', 'Inactive for (days) ≥'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor={`adv-${key}`}>
                {label}
              </label>
              <input
                id={`adv-${key}`}
                type="number"
                min={0}
                value={advancedFilters[key] ?? ''}
                onChange={(e) => {
                  setPage(1)
                  setAdvancedFilters((f) => ({ ...f, [key]: e.target.value || undefined }))
                }}
                className="crm-input h-8"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-quotationNumber">
              Quotation number
            </label>
            <input
              id="adv-quotationNumber"
              value={advancedFilters.quotationNumber ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, quotationNumber: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-closingHorizon">
              Closing horizon
            </label>
            <select
              id="adv-closingHorizon"
              value={advancedFilters.closingHorizon ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, closingHorizon: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Any</option>
              <option value="next_2_days">Next 2 days</option>
              <option value="next_3_days">Next 3 days</option>
              <option value="1_week">1 week</option>
              <option value="1_month">1 month</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {advancedFilters.closingHorizon === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="adv-closingFrom">
                  Closing from
                </label>
                <input
                  id="adv-closingFrom"
                  type="date"
                  value={advancedFilters.closingFrom ?? ''}
                  onChange={(e) => {
                    setPage(1)
                    setAdvancedFilters((f) => ({ ...f, closingFrom: e.target.value || undefined }))
                  }}
                  className="crm-input h-8"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="adv-closingTo">
                  Closing to
                </label>
                <input
                  id="adv-closingTo"
                  type="date"
                  value={advancedFilters.closingTo ?? ''}
                  onChange={(e) => {
                    setPage(1)
                    setAdvancedFilters((f) => ({ ...f, closingTo: e.target.value || undefined }))
                  }}
                  className="crm-input h-8"
                />
              </div>
            </>
          )}
          {(
            [
              ['territory', 'Territory'],
              ['serviceArea', 'Service area'],
              ['pinCode', 'Pin code'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor={`adv-${key}`}>
                {label}
              </label>
              <input
                id={`adv-${key}`}
                value={advancedFilters[key] ?? ''}
                onChange={(e) => {
                  setPage(1)
                  setAdvancedFilters((f) => ({ ...f, [key]: e.target.value || undefined }))
                }}
                className="crm-input h-8"
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-productCategory">
              Product category
            </label>
            <select
              id="adv-productCategory"
              value={advancedFilters.productCategory ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, productCategory: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Any</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-customerSegment">
              Customer segment
            </label>
            <select
              id="adv-customerSegment"
              value={advancedFilters.customerSegment ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, customerSegment: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Any</option>
              {CUSTOMER_SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-full flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Inactive for</span>
            <div className="flex flex-wrap gap-1.5">
              {INACTIVITY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setPage(1)
                    setAdvancedFilters((f) => ({
                      ...f,
                      inactivityDays: f.inactivityDays === p.value ? undefined : p.value,
                    }))
                  }}
                  className={cn(
                    'crm-chip',
                    advancedFilters.inactivityDays === p.value ? 'crm-chip-active' : 'crm-chip-idle'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-full flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Call/message density</span>
            <div className="flex flex-wrap gap-1.5">
              {DENSITY_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setPage(1)
                    setAdvancedFilters((f) => ({
                      ...f,
                      callsCountMin: f.callsCountMin === p.value ? undefined : p.value,
                    }))
                  }}
                  className={cn(
                    'crm-chip',
                    advancedFilters.callsCountMin === p.value ? 'crm-chip-active' : 'crm-chip-idle'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-full flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Date range</span>
            <div className="flex flex-wrap gap-1.5">
              {DATE_RANGE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const { from, to } = p.getRange()
                    setPage(1)
                    setDays('')
                    setFromDate(from)
                    setToDate(to)
                  }}
                  className={cn('crm-chip', 'crm-chip-idle')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-department">
              Department
            </label>
            <select
              id="adv-department"
              value={advancedFilters.department ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, department: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Any</option>
              <option value="Marketing">Marketing</option>
              <option value="Sales">Sales</option>
              <option value="Purchase">Purchase</option>
              <option value="Quotation">Quotation</option>
              <option value="Order">Order</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-status">
              Status
            </label>
            <select
              id="adv-status"
              value={advancedFilters.status ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, status: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Any</option>
              <option value="open">Open</option>
              <option value="closed_won">Closed Won</option>
              <option value="closed_lost">Closed Lost</option>
              <option value="disqualified">Disqualified</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="adv-assignedTo">
              Assigned to
            </label>
            <select
              id="adv-assignedTo"
              value={advancedFilters.assignedToId ?? ''}
              onChange={(e) => {
                setPage(1)
                setAdvancedFilters((f) => ({ ...f, assignedToId: e.target.value || undefined }))
              }}
              className="crm-input h-8"
            >
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2 pb-1.5">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={advancedFilters.slaBreached === 'true'}
                onChange={(e) => {
                  setPage(1)
                  setAdvancedFilters((f) => ({ ...f, slaBreached: e.target.checked ? 'true' : undefined }))
                }}
                className="h-4 w-4 rounded border-border"
              />
              SLA breached only
            </label>
          </div>

          <div className="col-span-full">
            <Button size="sm" variant="ghost" onClick={() => setAdvancedFilters({})}>
              Clear advanced filters
            </Button>
          </div>
        </div>
      )}

      <section aria-label="Smart views" className="overflow-x-auto">
        <div className="flex min-w-max gap-1.5">
          {visibleSmartViews.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => applySmartView(view)}
              className={cn('crm-chip', activeSmartView === view.id ? 'crm-chip-active' : 'crm-chip-idle')}
            >
              {view.label}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Lead stage filters" className="overflow-x-auto">
        <div className="flex min-w-max gap-1" role="tablist">
          {leadTabs.map((tab) => {
            const tabStage = tab.stage ?? ''
            const tabOutcome = tab.contactOutcome ?? ''
            const active = stage === tabStage && contactOutcome === tabOutcome
            return (
              <button
                key={tab.label}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => {
                  setPage(1)
                  setStage(tabStage)
                  setContactOutcome(tabOutcome)
                }}
                className={cn(
                  'crm-stage-tab',
                  active ? 'crm-stage-tab-active' : 'crm-stage-tab-idle'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </section>

      <PermissionGate permission="leads:assign">
        {view === 'list' && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <select
              value=""
              disabled={bulkBusy}
              onChange={(e) =>
                e.target.value &&
                bulkRun(
                  (id) => api.put(`/leads/${id}/assign`, { assignedToId: e.target.value }),
                  `${selected.size} lead(s) reassigned`
                )
              }
              className="crm-input h-8"
            >
              <option value="">Assign to…</option>
              {me && <option value={me.id}>Me ({me.fullName})</option>}
              {users
                .filter((u) => u.id !== me?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </select>
            <select
              value=""
              disabled={bulkBusy}
              onChange={(e) =>
                e.target.value &&
                bulkRun(
                  (id) => api.put(`/leads/${id}`, { priority: e.target.value }),
                  `${selected.size} lead(s) set to ${e.target.value}`
                )
              }
              className="crm-input h-8"
            >
              <option value="">Set priority…</option>
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </PermissionGate>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && leads.length === 0 ? (
        <LeadsLoadingState view={view} />
      ) : view === 'kanban' ? (
        <LeadsKanban data={leads} onChanged={refresh} />
      ) : (
        <>
          <LeadsTable
            data={leads}
            users={users}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onChanged={refresh}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            isPending={isPending}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(1)
                  setPageSize(Number(e.target.value))
                }}
                className="crm-input h-8 w-auto"
              >
                {[20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>
                Page {page} of {Math.max(totalPages, 1)} · {total} leads
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          </div>
        </>
      )}

      {showNewLead && (
        <Modal title="New Lead" onClose={() => setShowNewLead(false)}>
          <NewLeadForm
            onCreated={(leadId) => {
              setShowNewLead(false)
              router.push(`/leads/${leadId}`)
            }}
          />
        </Modal>
      )}

      {showImport && <LeadsImportModal onClose={() => setShowImport(false)} onImported={refresh} />}
      {showRules && <AssignmentRulesModal onClose={() => setShowRules(false)} />}

      {showExportOptions && (
        <Modal title="Export leads" onClose={() => setShowExportOptions(false)}>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Sources (leave empty for all)</p>
              <div className="flex flex-wrap gap-2">
                {LEAD_SOURCES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleExportSource(s)}
                    className={cn('crm-chip', exportSources.has(s) ? 'crm-chip-active' : 'crm-chip-idle')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Days of week (leave empty for all)</p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => toggleExportWeekday(d.value)}
                    className={cn('crm-chip', exportWeekdays.has(d.value) ? 'crm-chip-active' : 'crm-chip-idle')}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowExportOptions(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
