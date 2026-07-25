import { resolveMaskedFields } from './lead-serializer'

export { resolveMaskedFields }

const MASK_PLACEHOLDER = '••••••••'
const MASKABLE_CONTACT_FIELDS = new Set(['phone', 'email', 'gstNumber'])

/**
 * Redacts masked fields on a Contact before it reaches the response — same
 * policy as applyLeadFieldMask (lib/lead-serializer.ts) but for the flat
 * Contact shape (no nested contact object to reach through).
 * Returns a shallow copy; never mutates the input.
 */
export function applyContactFieldMask<T extends Record<string, unknown>>(contact: T, maskedFields: string[]): T {
  if (maskedFields.length === 0) return contact

  const masked: any = { ...contact }
  for (const field of maskedFields) {
    if (MASKABLE_CONTACT_FIELDS.has(field) && field in masked) {
      masked[field] = MASK_PLACEHOLDER
    }
  }
  return masked
}
