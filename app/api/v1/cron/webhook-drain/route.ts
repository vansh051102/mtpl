import { prisma } from '@/lib/db'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { normalizePhone } from '@/lib/normalize'
import { successResponse, withErrorHandler, UnauthorizedError } from '@/lib/api-response'
import { secureEqual } from '@/lib/secure-compare'

const BATCH_SIZE = 50

function placeholderEmail(phone: string): string {
  return `phone-${phone}@leads.whatsapp.veck.internal`
}

async function findOrCreateContact(orgId: string, createdById: string, phone: string, name: string | undefined) {
  const normalized = normalizePhone(phone)
  const [firstName, ...rest] = (name || 'WhatsApp Buyer').trim().split(/\s+/)
  const lastName = rest.join(' ') || '-'

  const existing = await prisma.contact.findFirst({ where: { orgId, phone: normalized, deletedAt: null } })
  if (existing) return existing

  return prisma.contact.create({
    data: {
      orgId,
      firstName,
      lastName,
      email: placeholderEmail(normalized),
      phone: normalized,
      source: 'WhatsApp Business',
      createdById,
    },
  })
}

// GET /api/v1/cron/webhook-drain - Processes queued WebhookPayload rows
// (Gap 13): duplicate-check + createLeadWithDefaults per row, same as the
// inline path each webhook used to run synchronously. On duplicate, attaches
// a re-inquiry Activity to the existing lead/contact instead of dropping it
// silently (Gap 25 omnichannel merge) rather than the old "duplicate_skipped"
// no-op. Failures move the row to DLQ with a reason for later inspection.
export const GET = withErrorHandler(async (req: Request) => {
  const secret = process.env.CRON_SECRET
  if (!secret || !secureEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new UnauthorizedError('Invalid cron secret')
  }

  const pending = await prisma.webhookPayload.findMany({
    where: { status: 'PENDING' },
    orderBy: { receivedAt: 'asc' },
    take: BATCH_SIZE,
  })

  let processed = 0
  let dlq = 0
  let skipped = 0

  for (const payload of pending) {
    // Atomic claim: only proceed if this row is still PENDING (protects
    // against an overlapping cron run picking up the same row).
    const claimed = await prisma.webhookPayload.updateMany({
      where: { id: payload.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    })
    if (claimed.count === 0) {
      skipped++
      continue
    }

    try {
      if (payload.sourceSystem === 'WHATSAPP') {
        const meta = payload.sourceMetadata as Record<string, unknown>
        const messageId = meta.messageId as string
        const systemUserId = meta.systemUserId as string
        const phone = payload.phone as string

        const existingLead = await prisma.lead.findFirst({
          where: { orgId: payload.orgId, externalId: messageId },
          select: { id: true, contactId: true },
        })

        if (existingLead) {
          // Omnichannel merge: same person re-engaging on a lead that already
          // exists — attach as a new thread rather than dropping it.
          await prisma.activity.create({
            data: {
              orgId: payload.orgId,
              leadId: existingLead.id,
              type: 'message',
              title: 'Repeat WhatsApp inbound',
              description: (meta.text as string) || undefined,
              status: 'completed',
              completedAt: new Date(),
              metadata: { channel: 'WHATSAPP', reInquiry: true },
              createdBy: systemUserId,
            },
          })
        } else {
          const contact = await findOrCreateContact(payload.orgId, systemUserId, phone, meta.profileName as string | undefined)
          const result = await createLeadWithDefaults({
            orgId: payload.orgId,
            contactId: contact.id,
            companyName: (meta.profileName as string) || contact.phone,
            priority: 'Medium',
            notes: meta.text as string | undefined,
            source: 'WhatsApp Business',
            sourceDetails: { waId: phone, type: meta.type as string },
            externalId: messageId,
            createdById: systemUserId,
          })

          if (result.duplicate) {
            await prisma.activity.create({
              data: {
                orgId: payload.orgId,
                leadId: result.existingLead.id,
                type: 'message',
                title: 'Repeat WhatsApp inbound',
                description: (meta.text as string) || undefined,
                status: 'completed',
                completedAt: new Date(),
                metadata: { channel: 'WHATSAPP', reInquiry: true },
                createdBy: systemUserId,
              },
            })
          }
        }
      }

      await prisma.webhookPayload.update({
        where: { id: payload.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      })
      processed++
    } catch (err) {
      await prisma.webhookPayload.update({
        where: { id: payload.id },
        data: { status: 'DLQ', dlqReason: err instanceof Error ? err.message : String(err) },
      })
      dlq++
    }
  }

  return successResponse({ checkedAt: new Date().toISOString(), found: pending.length, processed, dlq, skipped })
})
