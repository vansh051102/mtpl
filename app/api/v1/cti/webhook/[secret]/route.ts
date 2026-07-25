import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { CtiWebhookSchema } from '@/lib/validation'
import { normalizePhone } from '@/lib/normalize'
import { rateLimitResponse } from '@/lib/rate-limit'
import { webhookLimiter } from '@/lib/rate-limit-db'

interface Params {
  params: { secret: string }
}

// A manually-logged call within this window of the CTI event is treated as
// "the same call" for reconciliation, rather than creating a second entry.
const RECONCILE_WINDOW_MS = 15 * 60 * 1000
// If a manual entry claims at least this many minutes but the provider's
// duration is under 10s, the manual entry is very likely a mis-log.
const MISMATCH_MANUAL_MINUTES = 1
const MISMATCH_CTI_SECONDS = 10

// POST /api/v1/cti/webhook/:secret - Call telephony provider receiver (Gap
// 15). Receiver only — no outbound dialing integration exists; whichever
// provider (Twilio/Exotel/Knowlarity) is configured posts call telemetry
// here in this provider-agnostic shape once wired up. Reconciles against a
// manually-logged call on the matching Contact if one exists, else records
// the CTI event as its own (already-verified) Activity.
export async function POST(req: Request, { params }: Params) {
  const { allowed, retryAfter } = await webhookLimiter.check(req)
  if (!allowed) return rateLimitResponse(retryAfter)

  const settings = await prisma.settings.findFirst({
    where: { ctiWebhookSecret: params.secret },
    select: { orgId: true, ctiConfiguredBy: true },
  })
  if (!settings?.ctiConfiguredBy) {
    return NextResponse.json({ error: 'Unknown CTI integration' }, { status: 401 })
  }
  const { orgId, ctiConfiguredBy: systemUserId } = settings

  const body = await req.json().catch(() => null)
  const parsed = CtiWebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const { externalCallId, phone, durationSeconds, status, recordingUrl } = parsed.data

  const contact = await prisma.contact.findFirst({
    where: { orgId, phone: normalizePhone(phone), deletedAt: null },
  })
  if (!contact) {
    // Ack anyway — an unmatched number shouldn't make the provider retry forever.
    return NextResponse.json({ success: true, status: 'no_matching_contact' })
  }

  const alreadyReconciled = await prisma.activity.findFirst({
    where: { contactId: contact.id, metadata: { path: ['ctiExternalCallId'], equals: externalCallId } },
    select: { id: true },
  })
  if (alreadyReconciled) {
    return NextResponse.json({ success: true, status: 'duplicate_ignored' })
  }

  const since = new Date(Date.now() - RECONCILE_WINDOW_MS)
  const manualEntry = await prisma.activity.findFirst({
    where: { contactId: contact.id, type: 'call', ctiVerified: null, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  })

  const manualMinutes = manualEntry?.duration ?? 0
  const isMismatch = manualMinutes >= MISMATCH_MANUAL_MINUTES && durationSeconds < MISMATCH_CTI_SECONDS

  if (manualEntry) {
    await prisma.activity.update({
      where: { id: manualEntry.id },
      data: {
        ctiVerified: !isMismatch,
        metadata: {
          ...(manualEntry.metadata as Record<string, unknown>),
          ctiExternalCallId: externalCallId,
          ctiDurationSeconds: durationSeconds,
          ctiStatus: status,
          ctiRecordingUrl: recordingUrl,
          ...(isMismatch && { flag: 'SHORT_CALL_UNVERIFIED' }),
        },
      },
    })
  } else {
    await prisma.activity.create({
      data: {
        orgId,
        contactId: contact.id,
        type: 'call',
        title: `CTI: ${status}`,
        duration: Math.round(durationSeconds / 60),
        status: 'completed',
        completedAt: new Date(),
        ctiVerified: true,
        metadata: { ctiExternalCallId: externalCallId, ctiDurationSeconds: durationSeconds, ctiStatus: status, ctiRecordingUrl: recordingUrl },
        createdBy: systemUserId,
      },
    })
  }

  return NextResponse.json({ success: true, status: manualEntry ? 'reconciled' : 'recorded', mismatch: isMismatch })
}
