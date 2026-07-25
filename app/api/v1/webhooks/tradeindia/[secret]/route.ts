import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { TradeIndiaLeadSchema, type TradeIndiaLead } from '@/lib/validation'
import { rateLimitResponse } from '@/lib/rate-limit'
import { webhookLimiter } from '@/lib/rate-limit-db'
import { normalizeEmail, normalizePhone } from '@/lib/normalize'

interface Params {
  params: { secret: string }
}

function placeholderEmail(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, '') || 'unknown'
  return `phone-${digits}@leads.tradeindia.veck.internal`
}

async function findOrCreateContact(orgId: string, createdById: string, lead: TradeIndiaLead) {
  const email = normalizeEmail(lead.SENDER_EMAIL)
  const phone = normalizePhone(lead.SENDER_MOBILE || '')
  const [firstName, ...rest] = (lead.SENDER_NAME || 'TradeIndia Buyer').trim().split(/\s+/)
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
      source: 'TradeIndia',
      sourceDetails: { city: lead.SENDER_CITY, state: lead.SENDER_STATE },
      createdById,
    },
  })
}

// POST /api/v1/webhooks/tradeindia/:secret - Receives leads from TradeIndia's
// lead push webhook and creates a Contact + Lead. Same shape as the IndiaMART
// route: the `secret` path segment is looked up directly against
// Settings.tradeindiaWebhookSecret (unique per org), which resolves org/user
// too. Configured from the Integrations tab — no env vars required.
export async function POST(req: Request, { params }: Params) {
  const { allowed, retryAfter } = await webhookLimiter.check(req)
  if (!allowed) return rateLimitResponse(retryAfter)

  const settings = await prisma.settings.findFirst({
    where: { tradeindiaWebhookSecret: params.secret },
    select: { orgId: true, tradeindiaConfiguredBy: true },
  })
  if (!settings) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
  }
  const { orgId, tradeindiaConfiguredBy: systemUserId } = settings
  if (!systemUserId) {
    console.error(`TradeIndia webhook: org ${orgId} has a secret but no configuredBy user`)
    return NextResponse.json({ error: 'Integration misconfigured' }, { status: 500 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = TradeIndiaLeadSchema.safeParse(body)
  if (!parsed.success) {
    console.error('TradeIndia webhook payload validation failed:', parsed.error.flatten())
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const lead = parsed.data

  try {
    const existingLead = await prisma.lead.findFirst({
      where: { orgId, externalId: lead.QUERY_ID },
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
      source: 'TradeIndia',
      sourceDetails: { ...lead },
      externalId: lead.QUERY_ID,
      tags: lead.PRODUCT_NAME ? [lead.PRODUCT_NAME] : [],
      createdById: systemUserId,
    })

    if (result.duplicate) {
      return NextResponse.json(
        { success: true, status: 'duplicate_linked', leadId: result.existingLead.id },
        { status: 200 }
      )
    }

    return NextResponse.json({ success: true, status: 'created', leadId: result.lead.id }, { status: 201 })
  } catch (error) {
    console.error('TradeIndia webhook processing error:', error)
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
