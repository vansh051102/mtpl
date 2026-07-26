import { stageQueryValues } from '../lead-stages'

describe('stageQueryValues', () => {
  it('includes the legacy Closed Won alias when querying Order Confirmed', () => {
    expect(stageQueryValues('Order Confirmed')).toEqual(['Order Confirmed', 'Closed Won'])
  })

  it('returns just the stage for every other value', () => {
    expect(stageQueryValues('New Lead')).toEqual(['New Lead'])
    expect(stageQueryValues('Deal Lost')).toEqual(['Deal Lost'])
  })
})
