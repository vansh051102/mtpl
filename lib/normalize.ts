import { parsePhoneNumberFromString } from 'libphonenumber-js'

// Normalizers used for contact dedup so the same person entered slightly
// differently (case, spacing, punctuation) maps to one Contact row within an
// org. These feed the @@unique([orgId, email]) / @@unique([orgId, phone])
// constraints on Contact.

/** Lowercase + trim an email. Empty/whitespace becomes ''. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

const DEFAULT_PHONE_REGION = 'IN'

/**
 * Normalize a phone number for dedup: parse to full E.164 (+91XXXXXXXXXX)
 * assuming India as the default region when no country code is given, so
 * "09876543210" and "+919876543210" dedupe as the same number. Falls back to
 * a lightweight strip-and-preserve-plus when the input isn't a parseable
 * phone number (partial/malformed input shouldn't hard-fail contact
 * creation).
 */
export function normalizePhone(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim()
  if (!raw) return ''

  const parsed = parsePhoneNumberFromString(raw, DEFAULT_PHONE_REGION)
  if (parsed?.isValid()) return parsed.number

  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/[^0-9]/g, '')
  return hasPlus ? `+${digits}` : digits
}
