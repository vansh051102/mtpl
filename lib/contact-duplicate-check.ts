import { prisma } from './db'
import { normalizeEmail, normalizePhone } from './normalize'
import { canAccessLead } from './ownership'
import { DuplicateContactError } from './errors'

type DuplicateReason = 'phone' | 'email' | 'gst'

/**
 * Checks whether phone/GST/email (in that priority order — first match wins)
 * already belongs to a Contact in this org, and if so builds a
 * DuplicateContactError describing the existing contact/lead so the frontend
 * can offer view/log-as-repeat/reassign instead of a generic 409.
 *
 * Advisory only — a concurrent submit can still race past this and hit the
 * Contact table's @@unique([orgId,email])/@@unique([orgId,phone]) constraint;
 * callers should catch that P2002 and re-run this same check as a fallback.
 */
export async function checkContactDuplicate(
  orgId: string,
  input: { phone?: string; email?: string; gstNumber?: string },
  requester: { userId: string; role: string }
): Promise<DuplicateContactError | null> {
  const phone = input.phone ? normalizePhone(input.phone) : undefined
  const email = input.email ? normalizeEmail(input.email) : undefined
  const gstNumber = input.gstNumber?.trim().toUpperCase() || undefined

  // deletedAt: null — a soft-deleted contact's phone/email is free to reuse
  // (matches the partial unique indexes; see migration 20260726000000).
  const candidates: Array<{ reason: DuplicateReason; where: { orgId: string; deletedAt: null; phone?: string; email?: string; gstNumber?: string } }> = []
  if (phone) candidates.push({ reason: 'phone', where: { orgId, deletedAt: null, phone } })
  if (gstNumber) candidates.push({ reason: 'gst', where: { orgId, deletedAt: null, gstNumber } })
  if (email) candidates.push({ reason: 'email', where: { orgId, deletedAt: null, email } })

  for (const { reason, where } of candidates) {
    const existingContact = await prisma.contact.findFirst({
      where,
      select: { id: true, firstName: true, lastName: true },
    })
    if (existingContact) {
      return buildDuplicateError(reason, existingContact, requester)
    }
  }
  return null
}

async function buildDuplicateError(
  reason: DuplicateReason,
  existingContact: { id: string; firstName: string; lastName: string },
  requester: { userId: string; role: string }
): Promise<DuplicateContactError> {
  const existingLeadRow = await prisma.lead.findFirst({
    where: { contactId: existingContact.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      companyName: true,
      stage: true,
      assignedTo: { select: { fullName: true } },
    },
  })

  if (!existingLeadRow) {
    return new DuplicateContactError(`A contact with this ${reason} already exists.`, {
      reason,
      existingContact,
      existingLead: null,
      actions: ['reassign'],
    })
  }

  const canView = await canAccessLead(requester.userId, requester.role, existingLeadRow.id)
  if (!canView) {
    return new DuplicateContactError(
      'This contact already exists under another agent. Contact admin to reassign.',
      {
        reason,
        existingContact,
        existingLead: null,
        actions: ['reassign'],
      }
    )
  }

  return new DuplicateContactError(
    `This contact already has a lead: ${existingLeadRow.companyName} (${existingLeadRow.stage}), ` +
      `assigned to ${existingLeadRow.assignedTo?.fullName ?? 'unassigned'}.`,
    {
      reason,
      existingContact,
      existingLead: existingLeadRow,
      actions: ['view', 'logAsRepeat', 'reassign'],
    }
  )
}
