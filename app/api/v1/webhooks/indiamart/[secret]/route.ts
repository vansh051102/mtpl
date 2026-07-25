import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { IndiaMartWebhookSchema, type IndiaMartLeadResponse } from '@/lib/validation'
import { rateLimitResponse } from '@/lib/rate-limit'
import { webhookLimiter } from '@/lib/rate-limit-db'
import { normalizeEmail, normalizePhone } from '@/lib/normalize'

interface Params {
  params: { secret: string }
}

function placeholderEmail(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '') || 'unknown'
  return `phone-${digits}@leads.indiamart.veck.internal`
}

async function findOrCreateContact(orgId: string, createdById: string, lead: IndiaMartLeadResponse) {
  const email = normalizeEmail(lead.SENDER_EMAIL)
  const phone = normalizePhone(lead.SENDER_MOBILE || lead.SENDER_PHONE || '')
  const [firstName, ...rest] = (lead.SENDER_NAME || 'IndiaMART Buyer').trim().split(/\s+/)
  const lastName = rest.join(' ') || '-'

  const existing = email
    ? await prisma.contact.findFirst({ where: { orgId, email, deletedAt: null } })
    : phone
    ? await prisma.contact.findFirst({ where: { orgId, phone, deletedAt: null } })
    : null

  if (existing) return existing

  return prisma.contact.create({
    data: {
      orgId,
      firstName,
      lastName,
      email: email || placeholderEmail(phone),
      phone: phone || 'Not provided',
      alternatePhone: lead.SENDER_MOBILE_ALT,
      source: 'IndiaMART',
      sourceDetails: { queryMcatName: lead.QUERY_MCAT_NAME, city: lead.SENDER_CITY, state: lead.SENDER_STATE },
      createdById,
    },
  })
}

// POST /api/v1/webhooks/indiamart/:secret - Receives real-time leads from
// IndiaMART's Lead Manager CRM Push API and creates a Contact + Lead.
//
// Unauthenticated by design (server-to-server webhook) — the `secret` path
// segment IS the access control: it's looked up directly against
// Settings.indiamartWebhookSecret (unique per org), which also resolves
// which org/user to attribute the lead to. Configured entirely from the
// Integrations tab (Settings > Integrations) — no env vars required. Must
// be listed in middleware.ts's PUBLIC_ROUTES (covered by the /api/v1/webhooks
// prefix already there).
//
// IndiaMART deactivates the Push API integration if it doesn't see HTTP 200
// for 48 continuous hours, so this always returns 200 for well-formed,
// correctly-authenticated requests - including "already processed" (dedup)
// cases - reserving non-200 for auth failures and malformed payloads, which
// ARE worth IndiaMART retrying/alerting on.
export async function POST(req: Request, { params }: Params) {
  const { allowed, retryAfter } = await webhookLimiter.check(req)
  if (!allowed) return rateLimitResponse(retryAfter)

  const settings = await prisma.settings.findFirst({
    where: { indiamartWebhookSecret: params.secret },
    select: { orgId: true, indiamartConfiguredBy: true },
  })
  if (!settings) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
  }
  const { orgId, indiamartConfiguredBy: systemUserId } = settings
  if (!systemUserId) {
    console.error(`IndiaMART webhook: org ${orgId} has a secret but no configuredBy user`)
    return NextResponse.json({ error: 'Integration misconfigured' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = IndiaMartWebhookSchema.safeParse(body)
  if (!parsed.success) {
    console.error('IndiaMART webhook payload validation failed:', parsed.error.flatten())
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const lead = parsed.data.RESPONSE

  try {
    // Dedup: IndiaMART's UNIQUE_QUERY_ID is the idempotency key, scoped to the org.
    const existingLead = await prisma.lead.findFirst({
      where: { orgId, externalId: lead.UNIQUE_QUERY_ID },
      select: { id: true },
    })
    if (existingLead) {
      return NextResponse.json({ success: true, status: 'duplicate_skipped', leadId: existingLead.id })
    }

    const contact = await findOrCreateContact(orgId, systemUserId, lead)

    const result = await createLeadWithDefaults({
      orgId,
      contactId: contact.id,
      companyName: lead.SENDER_COMPANY || lead.SENDER_NAME || 'Unknown Company',
      priority: 'Medium',
      notes: lead.QUERY_MESSAGE,
      source: 'IndiaMART',
      sourceDetails: { ...lead },
      externalId: lead.UNIQUE_QUERY_ID,
      tags: lead.QUERY_PRODUCT_NAME ? [lead.QUERY_PRODUCT_NAME] : [],
      createdById: systemUserId,
    })

    if (result.duplicate) {
      // Auto-link: create a timeline event on the existing lead so the
      // assignee knows this buyer re-submitted via IndiaMART.
      const timeline = await prisma.timeline.upsert({
        where: { leadId: result.existingLead.id },
        create: { leadId: result.existingLead.id, orgId: result.existingLead.orgId },
        update: {},
      })
      await prisma.timelineEvent.create({
        data: {
          timelineId: timeline.id,
          type: 're_submission',
          title: `Re-submitted via IndiaMART — source: ${lead.SENDER_NAME || 'Buyer'}`,
          description: `Buyer ${lead.SENDER_NAME} submitted again. Already assigned to ${result.existingLead.assignedTo?.fullName ?? 'someone'}.`,
          metadata: { queryMessage: lead.QUERY_MESSAGE, productName: lead.QUERY_PRODUCT_NAME },
          createdBy: systemUserId,
        },
      })
      return NextResponse.json(
        { success: true, status: 'duplicate_linked', leadId: result.existingLead.id },
        { status: 200 }
      )
    }

    return NextResponse.json({ success: true, status: 'created', leadId: result.lead.id }, { status: 201 })
  } catch (error) {
    console.error('IndiaMART webhook processing error:', error)
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
