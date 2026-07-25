import { ValidationError } from './api-response'
import { StaleVersionError } from './errors'

// Pre-Lead Contact stages (subset of lib/lead-stages.ts ALL_STAGES — see the
// comment on Contact.stage in schema.prisma). Explicit matrix rather than
// Lead's generic isValidTransition() since there are only 3 states and one
// terminal one; a dedicated table is clearer here than reusing Lead's engine.
const CONTACT_TRANSITIONS: Record<string, readonly string[]> = {
  'New Lead': ['Contacted', 'Disqualified'],
  Contacted: ['Disqualified'],
  Disqualified: [],
}

export function assertContactTransitionAllowed(currentStage: string, toStage: string): void {
  const allowed = CONTACT_TRANSITIONS[currentStage]
  if (!allowed || !allowed.includes(toStage)) {
    throw new ValidationError(`Cannot move a contact from "${currentStage}" to "${toStage}"`)
  }
}

/** Same optimistic-lock pattern as Lead (lib/errors.ts StaleVersionError) —
 * only enforced when the client actually sends a version. */
export function assertContactVersion(contact: { version: number }, expectedVersion?: number): void {
  if (expectedVersion !== undefined && expectedVersion !== contact.version) {
    throw new StaleVersionError(contact)
  }
}
