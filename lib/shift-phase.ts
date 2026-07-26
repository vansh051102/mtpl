export type ShiftPhase = 'Priorities' | 'Midday' | 'Daily Review'

/** 9am-12pm Priorities, 12pm-5pm Midday, 5pm+ Daily Review. Pure function of the clock, no AI. */
export function getShiftPhase(date: Date): ShiftPhase {
  const hour = date.getHours()
  if (hour >= 9 && hour < 12) return 'Priorities'
  if (hour >= 12 && hour < 17) return 'Midday'
  return 'Daily Review'
}

export const SHIFT_PHASE_LABEL: Record<ShiftPhase, string> = {
  Priorities: 'Priorities Engine — overnight exceptions, today\'s targets',
  Midday: 'Mid-Course Correction — pace, dispatch, collections',
  'Daily Review': 'Daily Review — achievement vs. target, tomorrow\'s risk',
}
