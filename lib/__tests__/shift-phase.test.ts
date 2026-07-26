import { getShiftPhase } from '../shift-phase'

describe('getShiftPhase', () => {
  it('boundaries land on the correct phase', () => {
    expect(getShiftPhase(new Date(2026, 0, 1, 8, 59))).toBe('Daily Review')
    expect(getShiftPhase(new Date(2026, 0, 1, 9, 0))).toBe('Priorities')
    expect(getShiftPhase(new Date(2026, 0, 1, 11, 59))).toBe('Priorities')
    expect(getShiftPhase(new Date(2026, 0, 1, 12, 0))).toBe('Midday')
    expect(getShiftPhase(new Date(2026, 0, 1, 16, 59))).toBe('Midday')
    expect(getShiftPhase(new Date(2026, 0, 1, 17, 0))).toBe('Daily Review')
    expect(getShiftPhase(new Date(2026, 0, 1, 23, 0))).toBe('Daily Review')
  })
})
