export interface DashboardStats {
  total: number
  open: number
  hot: number
  wonThisMonth: number
  slaBreached: number
  byStage: Record<string, number>
  // Marketing-only
  contactedCount?: number
  qualifiedCount?: number
  newLeadCount?: number
  // Marketing + Admin — mirrors the leads-list sort-dropdown metrics
  kpi?: {
    recentlyActiveCount: number
    highestQuotationValue: number | null
    highestOrderValue: number | null
    highestMargin: number | null
    totalCalls: number
    totalMessages: number
  }
  // Sales-only
  activitiesThisWeek?: number
  dealAgingBuckets?: { '0-7d': number; '8-30d': number; '30d+': number }
  closeRate?: number | null
  callsToday?: number
  messagesToday?: number
  overdueFollowUps?: {
    id: string
    leadId: string
    title: string
    scheduledFor: string | null
    lead: { companyName: string } | null
  }[]
  // Purchase-only
  avgQualifiedToQuoteSentHours?: number | null
  // Admin-only
  recentQuoteSents?: {
    id: string
    companyName: string
    quotationNumber: string | null
    quotationValue: number | null
    supplierMargin: number | null
    productCategory: string | null
    stageChangedAt: string | null
    assignedTo: { fullName: string } | null
  }[]
  flaggedDisqualifications?: { fullName: string; count: number; lastAt: string }[]
  pipelineByClosingHorizon?: Record<string, number>
  highMarginLeads?: {
    id: string
    companyName: string
    supplierMargin: number | null
    assignedTo: { fullName: string } | null
  }[]
  regionalRevenue?: { territory: string; totalOrderValue: number; leadCount: number }[]
  recentImportExportActivity?: {
    id: string
    action: string
    resourceName: string | null
    userFullName: string
    timestamp: string
  }[]
}

export interface LeadSummary {
  id: string
  companyName: string
  stage: string
  priority: string
  createdAt: string
  contact: { firstName: string; lastName: string } | null
}
