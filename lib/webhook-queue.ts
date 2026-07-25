import { Prisma } from '@prisma/client'
import { prisma } from './db'

export interface EnqueueWebhookPayloadInput {
  orgId: string
  sourceSystem: string
  phone?: string
  email?: string
  companyName?: string
  sourceMetadata: Prisma.InputJsonValue
}

/** Writes an inbound lead payload to the queue and returns immediately —
 * the webhook route can respond 200 without waiting on duplicate-check/
 * lead-creation. A drain cron (app/api/v1/cron/webhook-drain) processes rows
 * async, so a traffic spike never blocks the webhook response or holds a
 * request-scoped DB connection open for the full dedup+create chain. */
export async function enqueueWebhookPayload(input: EnqueueWebhookPayloadInput) {
  return prisma.webhookPayload.create({ data: input })
}
