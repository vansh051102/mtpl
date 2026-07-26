import { detectAgedQuoteSentLeads, detectSlaBreachStreaks, healthFromScore } from '../command-center-engine'

jest.mock('@/lib/db', () => ({
  prisma: {
    lead: { findMany: jest.fn() },
    slaClock: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    anomalyFlag: { findFirst: jest.fn(), create: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  lead: { findMany: jest.Mock }
  slaClock: { findMany: jest.Mock }
  user: { findUnique: jest.Mock }
  anomalyFlag: { findFirst: jest.Mock; create: jest.Mock }
}

describe('healthFromScore', () => {
  it('is GREEN at or above 80', () => {
    expect(healthFromScore(80)).toBe('GREEN')
    expect(healthFromScore(100)).toBe('GREEN')
  })
  it('is YELLOW between 50 and 79', () => {
    expect(healthFromScore(50)).toBe('YELLOW')
    expect(healthFromScore(79)).toBe('YELLOW')
  })
  it('is RED below 50', () => {
    expect(healthFromScore(49)).toBe('RED')
    expect(healthFromScore(0)).toBe('RED')
  })
})

describe('detectAgedQuoteSentLeads', () => {
  beforeEach(() => {
    mockPrisma.lead.findMany.mockReset()
    mockPrisma.anomalyFlag.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.anomalyFlag.create.mockReset()
  })

  it('flags a lead in Quote Sent for more than 4 days', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead1',
        orgId: 'org1',
        companyName: 'Acme',
        assignedToId: 'user1',
        createdById: 'user1',
        stageChangedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ])
    const count = await detectAgedQuoteSentLeads()
    expect(count).toBe(1)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: 'org1', userId: 'user1', flagType: 'AGED_QUOTE_SENT', entityId: 'lead1' }),
      })
    )
  })

  it('does not re-flag within the dedupe window', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead1',
        orgId: 'org1',
        companyName: 'Acme',
        assignedToId: 'user1',
        createdById: 'user1',
        stageChangedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ])
    mockPrisma.anomalyFlag.findFirst.mockResolvedValue({ id: 'existing' })
    const count = await detectAgedQuoteSentLeads()
    expect(count).toBe(0)
    expect(mockPrisma.anomalyFlag.create).not.toHaveBeenCalled()
  })
})

describe('detectSlaBreachStreaks', () => {
  beforeEach(() => {
    mockPrisma.slaClock.findMany.mockReset()
    mockPrisma.lead.findMany.mockReset()
    mockPrisma.user.findUnique.mockReset().mockResolvedValue({ fullName: 'Rajesh' })
    mockPrisma.anomalyFlag.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.anomalyFlag.create.mockReset()
  })

  it('flags a rep with 3+ breached clocks in the window', async () => {
    mockPrisma.slaClock.findMany.mockResolvedValue([
      { orgId: 'org1', entityId: 'lead1' },
      { orgId: 'org1', entityId: 'lead2' },
      { orgId: 'org1', entityId: 'lead3' },
    ])
    mockPrisma.lead.findMany.mockResolvedValue([
      { id: 'lead1', assignedToId: 'user1' },
      { id: 'lead2', assignedToId: 'user1' },
      { id: 'lead3', assignedToId: 'user1' },
    ])
    const count = await detectSlaBreachStreaks()
    expect(count).toBe(1)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user1', flagType: 'SLA_BREACH_STREAK' }) })
    )
  })

  it('does not flag under the streak threshold', async () => {
    mockPrisma.slaClock.findMany.mockResolvedValue([
      { orgId: 'org1', entityId: 'lead1' },
      { orgId: 'org1', entityId: 'lead2' },
    ])
    mockPrisma.lead.findMany.mockResolvedValue([
      { id: 'lead1', assignedToId: 'user1' },
      { id: 'lead2', assignedToId: 'user1' },
    ])
    const count = await detectSlaBreachStreaks()
    expect(count).toBe(0)
    expect(mockPrisma.anomalyFlag.create).not.toHaveBeenCalled()
  })
})
