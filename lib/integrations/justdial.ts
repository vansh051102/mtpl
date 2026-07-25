import { prisma } from '@/lib/db'
import { createLeadWithDefaults } from '@/lib/lead-creation'
import { JustDialLeadSchema, type JustDialLead } from '@/lib/validation'
import { normalizeEmail, normalizePhone } from '@/lib/normalize'

function placeholderEmail(mobile: string): string {
  const digits = mobile.replace(/[^0-9]/g, '') || 'unknown'
  return `phone-${digits}@leads.justdial.veck.internal`
}

// ponytail: JustDial's actual Lead Manager API shape isn't confirmed yet —
// this fetch call is a stub to be swapped for the real endpoint + auth
// header once JustDial issues API docs/credentials.
async function fetchLeadsSince(apiKey: string, since: Date): Promise<JustDialLead[]> {
  const res = await fetch(
    `https://api.justdial.com/leadmanager/v1/leads?since=${since.toISOString()}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  )
  if (!res.ok) {
    throw new Error(`JustDial API error: ${res.status} ${res.statusText}`)
  }
  const body = await res.json()
  const raw = Array.isArray(body) ? body : body.leads ?? []
  return raw
    .map((entry: unknown) => JustDialLeadSchema.safeParse(entry))
    .filter((r: { success: boolean }) => r.success)
    .map((r: { data: JustDialLead }) => r.data)
}

async function findOrCreateContact(orgId: string, createdById: string, lead: JustDialLead) {
  const email = lead.email ? normalizeEmail(lead.email) : undefined
  const phone = lead.mobile ? normalizePhone(lead.mobile) : undefined

  const existing = email
    ? await prisma.contact.findFirst({ where: { orgId, email, deletedAt: null } })
    : phone
    ? await prisma.contact.findFirst({ where: { orgId, phone, deletedAt: null } })
    : null
  if (existing) return existing

  const [firstName, ...rest] = lead.name.trim().split(/\s+/)
  return prisma.contact.create({
    data: {
      orgId,
      firstName: firstName || 'JustDial',
      lastName: rest.join(' ') || '-',
      email: email || placeholderEmail(phone || ''),
      phone: phone || 'Not provided',
      source: 'JustDial',
      sourceDetails: { city: lead.city, category: lead.category },
      createdById,
    },
  })
}

export interface PollResult {
  orgId: string
  created: number
  duplicates: number
  skipped: number
}

/** Polls JustDial's Lead Manager API for one org's leads created since `since` and creates a Contact + Lead for each. */
async function pollOrg(orgId: string, apiKey: string, systemUserId: string, since: Date): Promise<PollResult> {
  const leads = await fetchLeadsSince(apiKey, since)
  const result: PollResult = { orgId, created: 0, duplicates: 0, skipped: 0 }

  for (const lead of leads) {
    const existingLead = await prisma.lead.findFirst({
      where: { orgId, externalId: lead.lead_id },
      select: { id: true },
    })
    if (existingLead) {
      result.duplicates++
      continue
    }

    const contact = await findOrCreateContact(orgId, systemUserId, lead)
    const created = await createLeadWithDefaults({
      orgId,
      contactId: contact.id,
      companyName: lead.company_name || lead.name,
      priority: 'Medium',
      notes: lead.message,
      source: 'JustDial',
      sourceDetails: { ...lead },
      externalId: lead.lead_id,
      tags: lead.category ? [lead.category] : [],
      createdById: systemUserId,
    })

    if (created.duplicate) {
      result.skipped++
    } else {
      result.created++
    }
  }

  return result
}

/**
 * Polls JustDial on behalf of every org that has an API key configured
 * (via the Integrations tab — Settings.justdialApiKey), for leads created
 * since `since`. One org's failure doesn't stop the others.
 */
export async function pollAllOrgs(since: Date): Promise<{ results: PollResult[]; errors: { orgId: string; error: string }[] }> {
  const configured = await prisma.settings.findMany({
    where: { justdialApiKey: { not: null }, justdialConfiguredBy: { not: null } },
    select: { orgId: true, justdialApiKey: true, justdialConfiguredBy: true },
  })

  const results: PollResult[] = []
  const errors: { orgId: string; error: string }[] = []

  for (const org of configured) {
    try {
      const result = await pollOrg(org.orgId, org.justdialApiKey!, org.justdialConfiguredBy!, since)
      results.push(result)
    } catch (error) {
      errors.push({ orgId: org.orgId, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return { results, errors }
}
