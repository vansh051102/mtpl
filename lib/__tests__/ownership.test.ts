import {
  buildOwnershipFilter,
  buildOwnershipFilterAsync,
  canAccessLead,
  canAccessContact,
  getUsersInSameTerritoryOrBranch,
  getUsersOnSameTeam,
} from '../ownership'
import { PURCHASE_QUERY_STAGES } from '../lead-stages'

// Reference the shared constant rather than a hand-copied list, so widening or
// narrowing purchase visibility can't silently drift away from these tests.
const PURCHASE_STAGES = [...PURCHASE_QUERY_STAGES]

jest.mock('@/lib/db', () => ({
  prisma: {
    lead: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    contact: { findUnique: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
const mockPrisma = prisma as unknown as {
  lead: { findUnique: jest.Mock }
  user: { findUnique: jest.Mock; findMany: jest.Mock }
  contact: { findUnique: jest.Mock }
}

describe('buildOwnershipFilter', () => {
  const U = 'user-1'

  it('admin sees everything (empty filter)', () => {
    expect(buildOwnershipFilter(U, 'admin', null, 'leads')).toEqual({})
  })

  it('marketing_manager sees Marketing-owned plus unassigned leads', () => {
    expect(buildOwnershipFilter(U, 'marketing_manager', null, 'leads')).toEqual({
      OR: [{ assignedToId: null }, { assignedTo: { department: 'Marketing' } }],
    })
  })

  it('marketing_executive scopes leads to self and activities via lead', () => {
    expect(buildOwnershipFilter(U, 'marketing_executive', null, 'leads')).toEqual({ assignedToId: U })
    expect(buildOwnershipFilter(U, 'marketing_executive', null, 'activities')).toEqual({
      lead: { assignedToId: U },
    })
  })

  it('sales_manager sees Sales-owned plus unassigned leads', () => {
    expect(buildOwnershipFilter(U, 'sales_manager', null, 'leads')).toEqual({
      OR: [{ assignedToId: null }, { assignedTo: { department: 'Sales' } }],
    })
  })

  it('sales_executive scopes leads to self', () => {
    expect(buildOwnershipFilter(U, 'sales_executive', null, 'leads')).toEqual({ assignedToId: U })
  })

  it('purchase scopes to own leads in purchase-visible stages', () => {
    expect(buildOwnershipFilter(U, 'purchase', null, 'leads')).toEqual({
      assignedToId: U,
      stage: { in: PURCHASE_STAGES },
    })
    expect(buildOwnershipFilter(U, 'purchase', null, 'quotes')).toEqual({
      lead: { assignedToId: U, stage: { in: PURCHASE_STAGES } },
    })
  })

  it('purchase-visible stages cover quote handoff and post-order procurement', () => {
    expect(PURCHASE_STAGES).toEqual([
      'Qualified',
      'Quote Sent',
      'Order Confirmed',
      'Order Closed',
      'Closed Won',
    ])
  })

  it('sales_purchase scopes to own assignments across resources', () => {
    expect(buildOwnershipFilter(U, 'sales_purchase', null, 'leads')).toEqual({ assignedToId: U })
    expect(buildOwnershipFilter(U, 'sales_purchase', null, 'quotes')).toEqual({
      lead: { assignedToId: U },
    })
  })

  it('unknown role denies all', () => {
    expect(buildOwnershipFilter(U, 'nonexistent', null, 'leads')).toEqual({ id: '__DENY_ALL__' })
  })

  it('marketing_executive scopes contacts to self (lead-gen "My Queue")', () => {
    expect(buildOwnershipFilter(U, 'marketing_executive', null, 'contacts')).toEqual({
      createdById: U,
    })
  })

  it('marketing_manager sees all org contacts (no department link on Contact)', () => {
    expect(buildOwnershipFilter(U, 'marketing_manager', null, 'contacts')).toEqual({})
  })

  it('admin sees all contacts', () => {
    expect(buildOwnershipFilter(U, 'admin', null, 'contacts')).toEqual({})
  })
})

describe('canAccessLead', () => {
  beforeEach(() => {
    mockPrisma.lead.findUnique.mockReset()
    mockPrisma.user.findUnique.mockReset()
  })

  it('admin always has access without a DB lookup', async () => {
    expect(await canAccessLead('u', 'admin', 'lead-1')).toBe(true)
    expect(mockPrisma.lead.findUnique).not.toHaveBeenCalled()
  })

  it('returns false when the lead does not exist', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue(null)
    expect(await canAccessLead('u', 'sales_executive', 'missing')).toBe(false)
  })

  it('sales_executive can access only their own lead', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'u', stage: 'New Lead' })
    expect(await canAccessLead('u', 'sales_executive', 'l')).toBe(true)
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'other', stage: 'New Lead' })
    expect(await canAccessLead('u', 'sales_executive', 'l')).toBe(false)
  })

  it('marketing_manager access depends on assignee department', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'a', stage: 'New Lead' })
    mockPrisma.user.findUnique.mockResolvedValue({ department: 'Marketing' })
    expect(await canAccessLead('u', 'marketing_manager', 'l')).toBe(true)
    mockPrisma.user.findUnique.mockResolvedValue({ department: 'Sales' })
    expect(await canAccessLead('u', 'marketing_manager', 'l')).toBe(false)
  })

  it('purchase needs ownership AND a Qualified/Quote Sent stage', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'u', stage: 'Quote Sent' })
    expect(await canAccessLead('u', 'purchase', 'l')).toBe(true)
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'u', stage: 'New Lead' })
    expect(await canAccessLead('u', 'purchase', 'l')).toBe(false)
  })

  it('unknown role is denied', async () => {
    mockPrisma.lead.findUnique.mockResolvedValue({ createdById: 'x', assignedToId: 'u', stage: 'New Lead' })
    expect(await canAccessLead('u', 'ghost', 'l')).toBe(false)
  })
})

describe('canAccessContact', () => {
  beforeEach(() => {
    mockPrisma.contact.findUnique.mockReset()
    mockPrisma.user.findUnique.mockReset()
  })

  it('roles with no defined Contact ownership model are permissive without a DB lookup', async () => {
    expect(await canAccessContact('u', 'admin', 'c-1')).toBe(true)
    expect(await canAccessContact('u', 'purchase', 'c-1')).toBe(true)
    expect(await canAccessContact('u', 'sales_purchase', 'c-1')).toBe(true)
    expect(mockPrisma.contact.findUnique).not.toHaveBeenCalled()
  })

  it('marketing_executive can access only contacts they created', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ createdById: 'u' })
    expect(await canAccessContact('u', 'marketing_executive', 'c-1')).toBe(true)
    mockPrisma.contact.findUnique.mockResolvedValue({ createdById: 'other' })
    expect(await canAccessContact('u', 'marketing_executive', 'c-1')).toBe(false)
  })

  it('returns false when the contact does not exist', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue(null)
    expect(await canAccessContact('u', 'marketing_executive', 'missing')).toBe(false)
  })

  it('marketing_manager without territory/branch set is permissive', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', territory: null, branch: null })
    expect(await canAccessContact('u', 'marketing_manager', 'c-1')).toBe(true)
    expect(mockPrisma.contact.findUnique).not.toHaveBeenCalled()
  })

  it('marketing_manager with territory set is scoped to territory peers', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ orgId: 'o1', territory: 'North', branch: null })
    mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'u' }, { id: 'peer' }])
    mockPrisma.contact.findUnique.mockResolvedValue({ createdById: 'peer' })
    expect(await canAccessContact('u', 'marketing_manager', 'c-1')).toBe(true)

    mockPrisma.user.findUnique.mockResolvedValueOnce({ orgId: 'o1', territory: 'North', branch: null })
    mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'u' }, { id: 'peer' }])
    mockPrisma.contact.findUnique.mockResolvedValue({ createdById: 'outsider' })
    expect(await canAccessContact('u', 'marketing_manager', 'c-1')).toBe(false)
  })

  it('sales_executive can access only contacts linked to their own lead', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [{ assignedToId: 'u' }] })
    expect(await canAccessContact('u', 'sales_executive', 'c-1')).toBe(true)

    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [{ assignedToId: 'other' }] })
    expect(await canAccessContact('u', 'sales_executive', 'c-1')).toBe(false)
  })

  it('sales_executive cannot access a contact with no linked lead', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [] })
    expect(await canAccessContact('u', 'sales_executive', 'c-1')).toBe(false)
  })

  it('sales_manager can access unassigned or Sales-department-linked contacts', async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [{ assignedToId: null }] })
    expect(await canAccessContact('u', 'sales_manager', 'c-1')).toBe(true)

    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [{ assignedToId: 'rep' }] })
    mockPrisma.user.findUnique.mockResolvedValue({ department: 'Sales' })
    expect(await canAccessContact('u', 'sales_manager', 'c-1')).toBe(true)

    mockPrisma.contact.findUnique.mockResolvedValue({ leads: [{ assignedToId: 'rep' }] })
    mockPrisma.user.findUnique.mockResolvedValue({ department: 'Marketing' })
    expect(await canAccessContact('u', 'sales_manager', 'c-1')).toBe(false)
  })
})

describe('getUsersInSameTerritoryOrBranch', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.user.findMany.mockReset()
  })

  it('returns null when the viewer has neither territory nor branch set', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', territory: null, branch: null })
    expect(await getUsersInSameTerritoryOrBranch('u')).toBeNull()
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns null when the viewer does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    expect(await getUsersInSameTerritoryOrBranch('missing')).toBeNull()
  })

  it('scopes to peers sharing territory or branch', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', territory: 'North', branch: null })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    const result = await getUsersInSameTerritoryOrBranch('u1')
    expect(result).toEqual(['u1', 'u2'])
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { orgId: 'o1', status: 'active', OR: [{ territory: 'North' }] },
      select: { id: true },
    })
  })
})

describe('getUsersOnSameTeam', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.user.findMany.mockReset()
  })

  it('returns null when the viewer has no team', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', teamId: null })
    expect(await getUsersOnSameTeam('u')).toBeNull()
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
  })

  it('returns null when the viewer does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    expect(await getUsersOnSameTeam('missing')).toBeNull()
  })

  it('scopes to active peers on the same team', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', teamId: 't1' })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }])
    const result = await getUsersOnSameTeam('u1')
    expect(result).toEqual(['u1', 'u2'])
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { orgId: 'o1', status: 'active', teamId: 't1' },
      select: { id: true },
    })
  })
})

describe('buildOwnershipFilterAsync — contacts ABAC', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.user.findMany.mockReset()
  })

  it('marketing_manager falls back to org-wide when no territory/branch configured', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', territory: null, branch: null })
    expect(await buildOwnershipFilterAsync('u', 'marketing_manager', null, 'contacts')).toEqual({})
  })

  it('marketing_manager scopes to territory peers when configured', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ orgId: 'o1', territory: 'North', branch: null })
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'u' }, { id: 'peer' }])
    expect(await buildOwnershipFilterAsync('u', 'marketing_manager', null, 'contacts')).toEqual({
      createdById: { in: ['u', 'peer'] },
    })
  })

  it('marketing_executive is unaffected (still self-scoped, no DB lookup)', async () => {
    expect(await buildOwnershipFilterAsync('u', 'marketing_executive', null, 'contacts')).toEqual({
      createdById: 'u',
    })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })
})
