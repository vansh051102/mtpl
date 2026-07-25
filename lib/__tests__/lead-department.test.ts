import { getLeadDepartment, getDepartmentWhereClause } from '../lead-department'

describe('getLeadDepartment', () => {
  it('maps New Lead / Contacted to Marketing', () => {
    expect(getLeadDepartment({ stage: 'New Lead' })).toBe('Marketing')
    expect(getLeadDepartment({ stage: 'Contacted' })).toBe('Marketing')
  })

  it('maps Qualified (no open PurchaseRequest) to Sales', () => {
    expect(getLeadDepartment({ stage: 'Qualified' })).toBe('Sales')
    expect(getLeadDepartment({ stage: 'Qualified', purchaseRequests: [] })).toBe('Sales')
  })

  it('a Qualified lead with an open PurchaseRequest reports Purchase, not Sales', () => {
    expect(
      getLeadDepartment({ stage: 'Qualified', purchaseRequests: [{ status: 'pending' }] })
    ).toBe('Purchase')
  })

  it('open PurchaseRequest overrides Purchase regardless of stage', () => {
    expect(
      getLeadDepartment({ stage: 'Quote Sent', purchaseRequests: [{ status: 'pending' }] })
    ).toBe('Purchase')
  })

  it('a non-open (hypothetical future) PurchaseRequest status does not force Purchase', () => {
    expect(
      getLeadDepartment({ stage: 'Qualified', purchaseRequests: [{ status: 'completed' }] })
    ).toBe('Sales')
  })

  it('maps Quote Sent to Quotation', () => {
    expect(getLeadDepartment({ stage: 'Quote Sent' })).toBe('Quotation')
  })

  it('maps Order Confirmed / Order Closed to Order', () => {
    expect(getLeadDepartment({ stage: 'Order Confirmed' })).toBe('Order')
    expect(getLeadDepartment({ stage: 'Order Closed' })).toBe('Order')
  })

  it('maps Deal Lost / Disqualified to Closed', () => {
    expect(getLeadDepartment({ stage: 'Deal Lost' })).toBe('Closed')
    expect(getLeadDepartment({ stage: 'Disqualified' })).toBe('Closed')
  })
})

describe('getDepartmentWhereClause', () => {
  it('returns the stage-based clause for Marketing', () => {
    expect(getDepartmentWhereClause('Marketing')).toEqual({ stage: { in: ['New Lead', 'Contacted'] } })
  })

  it('returns a purchaseRequests relation filter for Purchase', () => {
    expect(getDepartmentWhereClause('Purchase')).toEqual({
      purchaseRequests: { some: { status: { in: ['pending'] } } },
    })
  })

  it('excludes leads with an open PurchaseRequest from Sales', () => {
    expect(getDepartmentWhereClause('Sales')).toEqual({
      stage: 'Qualified',
      purchaseRequests: { none: { status: { in: ['pending'] } } },
    })
  })

  it('returns an empty clause for an unrecognized department', () => {
    expect(getDepartmentWhereClause('NotADepartment')).toEqual({})
  })

  it('excludes leads with an open PurchaseRequest from Quotation, matching the badge', () => {
    // A {stage: 'Quote Sent', open PR} lead's badge is 'Purchase' (open-PR
    // check wins in getLeadDepartment) — the Quotation filter must not also
    // match leads whose badge disagrees with it.
    expect(getDepartmentWhereClause('Quotation')).toEqual({
      stage: 'Quote Sent',
      purchaseRequests: { none: { status: { in: ['pending'] } } },
    })
  })
})
