import { logContactFieldDiffs } from '../field-diff'

jest.mock('@/lib/db', () => ({
  prisma: { leadFieldDiff: { createMany: jest.fn() } },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as { leadFieldDiff: { createMany: jest.Mock } }

describe('logContactFieldDiffs', () => {
  beforeEach(() => {
    mockPrisma.leadFieldDiff.createMany.mockReset()
  })

  it('logs only fields that actually changed', async () => {
    await logContactFieldDiffs(
      'org1',
      'c1',
      'user1',
      { firstName: 'Old', phone: '123', email: 'same@x.com' },
      { firstName: 'New', phone: '123', email: 'same@x.com' }
    )
    expect(mockPrisma.leadFieldDiff.createMany).toHaveBeenCalledWith({
      data: [
        { orgId: 'org1', contactId: 'c1', modifiedByUserId: 'user1', fieldName: 'firstName', oldValue: 'Old', newValue: 'New' },
      ],
    })
  })

  it('does not write when nothing changed', async () => {
    await logContactFieldDiffs('org1', 'c1', 'user1', { firstName: 'Same' }, { firstName: 'Same' })
    expect(mockPrisma.leadFieldDiff.createMany).not.toHaveBeenCalled()
  })

  it('handles null/undefined transitions as strings', async () => {
    await logContactFieldDiffs('org1', 'c1', 'user1', { designation: null }, { designation: 'Manager' })
    expect(mockPrisma.leadFieldDiff.createMany).toHaveBeenCalledWith({
      data: [
        { orgId: 'org1', contactId: 'c1', modifiedByUserId: 'user1', fieldName: 'designation', oldValue: null, newValue: 'Manager' },
      ],
    })
  })

  it('ignores fields not present on the before-object', async () => {
    await logContactFieldDiffs('org1', 'c1', 'user1', {}, { someUnrelatedField: 'x' })
    expect(mockPrisma.leadFieldDiff.createMany).not.toHaveBeenCalled()
  })
})
