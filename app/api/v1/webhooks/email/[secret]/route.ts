import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { SendGridInboundSchema } from '@/lib/validation'
import { rateLimitResponse } from '@/lib/rate-limit'
import { webhookLimiter } from '@/lib/rate-limit-db'
import { normalizeEmail } from '@/lib/normalize'

interface Params {
  params: { secret: string }
}

// Sender header looks like `"Jane Doe" <jane@example.com>` or plain `jane@example.com`.
function parseFrom(from: string): { name: string; email: string } {
  const match = from.match(/^"?([^"<]*)"?\s*<([^>]+)>$/)
  if (match) {
    return { name: match[1].trim() || 'Email Buyer', email: match[2].trim() }
  }
  return { name: 'Email Buyer', email: from.trim() }
}

async function findOrCreateContact(orgId: string, createdById: string, from: string) {
  const { name, email: rawEmail } = parseFrom(from)
  const email = normalizeEmail(rawEmail) || rawEmail
  const [firstName, ...rest] = name.split(/\s+/)
  const lastName = rest.join(' ') || '-'

  const existing = await prisma.contact.findFirst({ where: { orgId, email, deletedAt: null } })
  if (existing) return existing

  return prisma.contact.create({
    data: {
      orgId,
      firstName: firstName || 'Email',
      lastName,
      email,
      phone: 'Not provided',
      source: 'Email',
      createdById,
    },
  })
}

// POST /api/v1/webhooks/email/:secret - Receives inbound mail from
// SendGrid's Inbound Parse webhook and creates a Contact + Lead.
//
// Unauthenticated by design; the `secret` path segment is looked up directly
// against Settings.emailInboundSecret (unique per org), which resolves
// org/user too. Configured from the Integrations tab — no env vars required.
// Point a veck.in subdomain's MX record at SendGrid, then set its Inbound
// Parse destination URL to this route with the secret from the tab.
export async function POST(req: Request, { params }: Params) {
  const { allowed, retryAfter } = await webhookLimiter.check(req)
  if (!allowed) return rateLimitResponse(retryAfter)

  const settings = await prisma.settings.findFirst({
    where: { emailInboundSecret: params.secret },
    select: { orgId: true, emailConfiguredBy: true },
  })
  if (!settings) {
    return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 })
  }
  const { orgId, emailConfiguredBy: systemUserId } = settings
  if (!systemUserId) {
    console.error(`Email webhook: org ${orgId} has a secret but no configuredBy user`)
    return NextResponse.json({ error: 'Integration misconfigured' }, { status: 500 })
  }

  let payload: Record<string, unknown>
  try {
    const form = await req.formData()
    payload = Object.fromEntries(form.entries())
  } catch {
    return NextResponse.json({ error: 'Invalid form body' }, { status: 400 })
  }

  const parsed = SendGridInboundSchema.safeParse(payload)
  if (!parsed.success) {
    console.error('Email webhook payload validation failed:', parsed.error.flatten())
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }
  const mail = parsed.data

  try {
    const contact = await findOrCreateContact(orgId, systemUserId, mail.from)

    const result = await createLeadWithDefaults({
      orgId,
      contactId: contact.id,
      companyName: contact.email,
      priority: 'Medium',
      notes: mail.text || mail.html,
      source: 'Email',
      sourceDetails: { subject: mail.subject, from: mail.from, to: mail.to },
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
    console.error('Email webhook processing error:', error)
    return NextResponse.json({ error: 'Internal processing error' }, { status: 500 })
  }
}
