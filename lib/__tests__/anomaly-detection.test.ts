import { runAnomalyDetection } from '../anomaly-detection'

jest.mock('@/lib/db', () => ({
  prisma: {
    activity: { groupBy: jest.fn(), findMany: jest.fn() },
    auditLog: { groupBy: jest.fn() },
    anomalyFlag: { findFirst: jest.fn(), create: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  activity: { groupBy: jest.Mock; findMany: jest.Mock }
  auditLog: { groupBy: jest.Mock }
  anomalyFlag: { findFirst: jest.Mock; create: jest.Mock }
}

describe('runAnomalyDetection', () => {
  beforeEach(() => {
    mockPrisma.activity.groupBy.mockReset().mockResolvedValue([])
    mockPrisma.activity.findMany.mockReset().mockResolvedValue([])
    mockPrisma.auditLog.groupBy.mockReset().mockResolvedValue([])
    mockPrisma.anomalyFlag.findFirst.mockReset().mockResolvedValue(null)
    mockPrisma.anomalyFlag.create.mockReset()
  })

  it('flags a user over the velocity threshold', async () => {
    mockPrisma.activity.groupBy.mockResolvedValue([
      { orgId: 'org1', createdBy: 'user1', _count: { _all: 20 } },
    ])
    const result = await runAnomalyDetection()
    expect(result.velocitySpikes).toBe(1)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: 'org1', userId: 'user1', flagType: 'VELOCITY_SPIKE' }) })
    )
  })

  it('does not flag under the velocity threshold', async () => {
    mockPrisma.activity.groupBy.mockResolvedValue([
      { orgId: 'org1', createdBy: 'user1', _count: { _all: 5 } },
    ])
    const result = await runAnomalyDetection()
    expect(result.velocitySpikes).toBe(0)
  })

  it('never flags the system user', async () => {
    mockPrisma.activity.groupBy.mockResolvedValue([
      { orgId: 'org1', createdBy: 'system', _count: { _all: 999 } },
    ])
    const result = await runAnomalyDetection()
    expect(result.velocitySpikes).toBe(0)
  })

  it('does not re-flag within the dedupe window', async () => {
    mockPrisma.activity.groupBy.mockResolvedValue([
      { orgId: 'org1', createdBy: 'user1', _count: { _all: 20 } },
    ])
    mockPrisma.anomalyFlag.findFirst.mockResolvedValue({ id: 'existing-flag' })
    const result = await runAnomalyDetection()
    expect(result.velocitySpikes).toBe(0)
    expect(mockPrisma.anomalyFlag.create).not.toHaveBeenCalled()
  })

  it('flags CTI/manual duration mismatches surfaced by the CTI webhook', async () => {
    // First findMany call resolves the distinct orgIds to scan; second is the
    // per-org candidate scan (see A7: per-org scoping of the 200-row cap).
    mockPrisma.activity.findMany
      .mockResolvedValueOnce([{ orgId: 'org1' }])
      .mockResolvedValueOnce([
        { id: 'act1', orgId: 'org1', contactId: 'c1', createdBy: 'user1', metadata: { flag: 'SHORT_CALL_UNVERIFIED' } },
        { id: 'act2', orgId: 'org1', contactId: 'c2', createdBy: 'user2', metadata: { outcome: 'Connected' } },
      ])
    const result = await runAnomalyDetection()
    expect(result.durationMismatches).toBe(1)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagType: 'DURATION_MISMATCH', contactId: 'c1' }) })
    )
  })

  it('scopes the 200-row scan cap per org, not globally', async () => {
    mockPrisma.activity.findMany
      .mockResolvedValueOnce([{ orgId: 'org1' }, { orgId: 'org2' }])
      .mockResolvedValueOnce([
        { id: 'act1', orgId: 'org1', contactId: 'c1', createdBy: 'user1', metadata: { flag: 'SHORT_CALL_UNVERIFIED' } },
      ])
      .mockResolvedValueOnce([
        { id: 'act2', orgId: 'org2', contactId: 'c2', createdBy: 'user2', metadata: { flag: 'SHORT_CALL_UNVERIFIED' } },
      ])
    const result = await runAnomalyDetection()
    expect(result.durationMismatches).toBe(2)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: 'c1', orgId: 'org1' }) })
    )
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contactId: 'c2', orgId: 'org2' }) })
    )
  })

  it('flags modal-open spam over the threshold', async () => {
    mockPrisma.auditLog.groupBy.mockResolvedValue([
      { orgId: 'org1', userId: 'user1', _count: { _all: 45 } },
    ])
    const result = await runAnomalyDetection()
    expect(result.modalSpam).toBe(1)
    expect(mockPrisma.anomalyFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flagType: 'MODAL_SPAM', userId: 'user1' }) })
    )
  })
})
