import { resolveEmployeeStatuses } from '../employee-status'

jest.mock('@/lib/db', () => ({
  prisma: { activity: { findMany: jest.fn() } },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as { activity: { findMany: jest.Mock } }

const NOW = Date.now()

describe('resolveEmployeeStatuses', () => {
  beforeEach(() => {
    mockPrisma.activity.findMany.mockReset()
  })

  it('offline users never get promoted regardless of activity', async () => {
    mockPrisma.activity.findMany.mockResolvedValue([])
    const statuses = await resolveEmployeeStatuses('org1', [{ id: 'u1', liveAvailability: 'OFFLINE', lastLogin: new Date(NOW) }])
    expect(statuses.get('u1')).toBe('OFFLINE')
  })

  it('ON_CALL takes priority over BUSY for an online user with both signals', async () => {
    mockPrisma.activity.findMany
      .mockResolvedValueOnce([{ createdBy: 'u1', scheduledFor: new Date(NOW - 60_000), duration: 30 }])
      .mockResolvedValueOnce([{ createdBy: 'u1' }])
    const statuses = await resolveEmployeeStatuses('org1', [{ id: 'u1', liveAvailability: 'ONLINE', lastLogin: new Date(NOW) }])
    expect(statuses.get('u1')).toBe('ON_CALL')
  })

  it('AVAILABLE when online with no recent activity or in-progress call', async () => {
    mockPrisma.activity.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const statuses = await resolveEmployeeStatuses('org1', [{ id: 'u1', liveAvailability: 'ONLINE', lastLogin: new Date(NOW) }])
    expect(statuses.get('u1')).toBe('AVAILABLE')
  })
})
