import { getActivityFeed } from '../activity-feed'

jest.mock('@/lib/db', () => ({
  prisma: {
    timelineEvent: { findMany: jest.fn() },
    anomalyFlag: { findMany: jest.fn() },
    quote: { findMany: jest.fn() },
    purchaseRequest: { findMany: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  timelineEvent: { findMany: jest.Mock }
  anomalyFlag: { findMany: jest.Mock }
  quote: { findMany: jest.Mock }
  purchaseRequest: { findMany: jest.Mock }
}

describe('getActivityFeed', () => {
  it('merges sources in descending chronological order', async () => {
    mockPrisma.timelineEvent.findMany.mockResolvedValue([
      { id: 't1', title: 'Stage changed', description: null, createdAt: new Date('2026-01-01T10:00:00Z') },
    ])
    mockPrisma.anomalyFlag.findMany.mockResolvedValue([
      { id: 'a1', flagType: 'SLA_BREACH', description: 'breach', flaggedAt: new Date('2026-01-01T12:00:00Z') },
    ])
    mockPrisma.quote.findMany
      .mockResolvedValueOnce([{ id: 'q1', quoteNumber: 'Q-1', sentAt: new Date('2026-01-01T09:00:00Z') }])
      .mockResolvedValueOnce([])
    mockPrisma.purchaseRequest.findMany.mockResolvedValue([])

    const feed = await getActivityFeed('org1')

    expect(feed.map((f) => f.id)).toEqual(['anomaly-a1', 'timeline-t1', 'quote-sent-q1'])
  })
})
