import { prisma } from './db'

/**
 * Logs one immutable LeadFieldDiff row per field that actually changed
 * between `before` and the values in `patch` (Gap 21). Called before the
 * real update commits so a diff is on record even if something downstream
 * of the caller fails after — this function itself never throws into the
 * caller's transaction, a missed audit row is preferable to blocking a save.
 */
export async function logContactFieldDiffs(
  orgId: string,
  contactId: string,
  modifiedByUserId: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): Promise<void> {
  const rows = Object.entries(patch)
    .filter(([field, newValue]) => field in before && before[field] !== newValue)
    .map(([field, newValue]) => ({
      orgId,
      contactId,
      modifiedByUserId,
      fieldName: field,
      oldValue: before[field] === null || before[field] === undefined ? null : String(before[field]),
      newValue: newValue === null || newValue === undefined ? null : String(newValue),
    }))

  if (rows.length === 0) return
  await prisma.leadFieldDiff.createMany({ data: rows })
}
