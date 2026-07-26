import { prisma } from './db'

export interface ActivityFeedItem {
  id: string
  timestamp: string
  title: string
  description: string | null
  kind: 'stage_change' | 'sla_breach' | 'quote_sent' | 'quote_accepted' | 'rfq_sent'
}

const FEED_LIMIT = 20

/** Merges real event sources into one chronological feed — no fabricated
 * "payment received" entries; Payment isn't tracked in this schema (see the
 * Customer/Supplier note in prisma/schema.prisma). */
export async function getActivityFeed(orgId: string): Promise<ActivityFeedItem[]> {
  const [timelineEvents, anomalies, quotesSent, quotesAccepted, rfqsSent] = await Promise.all([
    prisma.timelineEvent.findMany({
      where: { timeline: { orgId } },
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, title: true, description: true, createdAt: true },
    }),
    prisma.anomalyFlag.findMany({
      where: { orgId, resolvedAt: null },
      orderBy: { flaggedAt: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, flagType: true, description: true, flaggedAt: true },
    }),
    prisma.quote.findMany({
      where: { orgId, deletedAt: null, sentAt: { not: null } },
      orderBy: { sentAt: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, quoteNumber: true, sentAt: true },
    }),
    prisma.quote.findMany({
      where: { orgId, deletedAt: null, acceptedAt: { not: null } },
      orderBy: { acceptedAt: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, quoteNumber: true, acceptedAt: true },
    }),
    prisma.purchaseRequest.findMany({
      where: { orgId, sentToSupplierAt: { not: null } },
      orderBy: { sentToSupplierAt: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, prNumber: true, sentToSupplierAt: true },
    }),
  ])

  const items: ActivityFeedItem[] = [
    ...timelineEvents.map((e) => ({
      id: `timeline-${e.id}`,
      timestamp: e.createdAt.toISOString(),
      title: e.title,
      description: e.description,
      kind: 'stage_change' as const,
    })),
    ...anomalies.map((a) => ({
      id: `anomaly-${a.id}`,
      timestamp: a.flaggedAt.toISOString(),
      title: a.flagType.replace(/_/g, ' '),
      description: a.description,
      kind: 'sla_breach' as const,
    })),
    ...quotesSent.map((q) => ({
      id: `quote-sent-${q.id}`,
      timestamp: q.sentAt!.toISOString(),
      title: `Quote ${q.quoteNumber} sent`,
      description: null,
      kind: 'quote_sent' as const,
    })),
    ...quotesAccepted.map((q) => ({
      id: `quote-accepted-${q.id}`,
      timestamp: q.acceptedAt!.toISOString(),
      title: `Quote ${q.quoteNumber} accepted`,
      description: null,
      kind: 'quote_accepted' as const,
    })),
    ...rfqsSent.map((pr) => ({
      id: `rfq-${pr.id}`,
      timestamp: pr.sentToSupplierAt!.toISOString(),
      title: `RFQ ${pr.prNumber} sent to supplier`,
      description: null,
      kind: 'rfq_sent' as const,
    })),
  ]

  return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, FEED_LIMIT)
}
