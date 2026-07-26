import { getExecutivePriorities } from '../executive-priorities'

jest.mock('@/lib/db', () => ({
  prisma: {
    quote: { count: jest.fn() },
    lead: { count: jest.fn(), findMany: jest.fn() },
    purchaseRequest: { findMany: jest.fn(), count: jest.fn() },
    target: { findFirst: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  quote: { count: jest.Mock }
  lead: { count: jest.Mock; findMany: jest.Mock }
  purchaseRequest: { findMany: jest.Mock; count: jest.Mock }
  target: { findFirst: jest.Mock }
}

describe('getExecutivePriorities', () => {
  beforeEach(() => {
    mockPrisma.quote.count.mockReset().mockResolvedValue(0)
    mockPrisma.lead.count.mockReset().mockResolvedValue(0)
    mockPrisma.lead.findMany.mockReset().mockResolvedValue([])
    mockPrisma.purchaseRequest.findMany.mockReset().mockResolvedValue([])
    mockPrisma.purchaseRequest.count.mockReset().mockResolvedValue(0)
    mockPrisma.target.findFirst.mockReset().mockResolvedValue(null)
  })

  it('returns empty list when nothing is wrong', async () => {
    expect(await getExecutivePriorities('org1')).toEqual([])
  })

  it('sorts RED before ORANGE and skips missing Target silently', async () => {
    mockPrisma.quote.count.mockResolvedValue(8)
    mockPrisma.lead.count.mockResolvedValue(12)

    const priorities = await getExecutivePriorities('org1')

    expect(priorities.map((p) => p.severity)).toEqual(['RED', 'ORANGE'])
    expect(priorities[0].message).toContain('8 quotations')
  })
})
