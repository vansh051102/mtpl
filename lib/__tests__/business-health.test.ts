import { computeOverallHealth, SALES_WEIGHT, LEADGEN_WEIGHT, PURCHASE_WEIGHT, PEOPLE_WEIGHT, SLA_WEIGHT } from '../business-health'

jest.mock('@/lib/db', () => ({
  prisma: {
    kpiSnapshot: { findMany: jest.fn() },
    slaClock: { findMany: jest.fn() },
    departmentHealthSnapshot: { findFirst: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  kpiSnapshot: { findMany: jest.Mock }
  slaClock: { findMany: jest.Mock }
  departmentHealthSnapshot: { findFirst: jest.Mock }
}

describe('computeOverallHealth', () => {
  it('weights sum to 1.0', () => {
    expect(SALES_WEIGHT + LEADGEN_WEIGHT + PURCHASE_WEIGHT + PEOPLE_WEIGHT + SLA_WEIGHT).toBeCloseTo(1.0)
  })

  it('produces the expected weighted score for known inputs', async () => {
    mockPrisma.departmentHealthSnapshot.findFirst.mockImplementation(({ where }: any) => {
      const scores: Record<string, number> = { Sales: 90, Marketing: 80, Purchase: 70, Management: 80 }
      return Promise.resolve({ department: where.department, score: scores[where.department] })
    })
    mockPrisma.kpiSnapshot.findMany.mockResolvedValue([{ value: 100 }])
    mockPrisma.slaClock.findMany.mockResolvedValue([{ status: 'active' }, { status: 'breached' }])

    const result = await computeOverallHealth('org1')

    // sales 90*.35 + leadGen 80*.25 + purchase 70*.20 + people 100*.10 + sla 50*.10
    expect(result.overallScore).toBeCloseTo(90 * 0.35 + 80 * 0.25 + 70 * 0.2 + 100 * 0.1 + 50 * 0.1)
    expect(result.sales).toBe(90)
    expect(result.leadGen).toBe(80)
    expect(result.purchase).toBe(70)
  })
})
