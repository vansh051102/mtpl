import { prisma } from './db'
import { startSlaClock } from './sla-engine'
import { createSopChecklistsForStage } from './sop-checklists'
import { pickAssignee } from './auto-assign'
import type { Prisma, Lead } from '@prisma/client'

export interface CreateLeadInput {
  orgId: string
  contactId: string
  companyName: string
  priority?: string
  notes?: string
  source?: string
  sourceDetails?: Prisma.InputJsonValue
  externalId?: string
  tags?: string[]
  createdById: string
  /** Explicit assignee (e.g. from an import row) — bypasses auto-assignment when set. */
  assignedToId?: string
  /** Creator role — selects marketing vs sales New Lead SOP checklists. */
  creatorRole?: string
  /** Skip the open-lead-per-contact duplicate block — used for "log as repeat
   *  enquiry", where a second lead for the same contact is intentional. */
  allowRepeat?: boolean
  closingHorizon?: string
  targetClosingDate?: Date
  territory?: string
  serviceArea?: string
  pinCode?: string | null
  quotationValue?: number
  orderValue?: number
  customerSegment?: string | null
  productCategory?: string
  requirement?: string
  quotationNumber?: string
  supplierMargin?: number
}

export type CreateLeadResult =
  | { duplicate: false; lead: Lead }
  | {
      duplicate: true
      existingLead: {
        id: string
        orgId: string
        companyName: string
        stage: string
        assignedTo: { fullName: string } | null
      }
    }

/**
 * Creates a lead plus its NEW_LEAD checklist and initial timeline event, in
 * a single transaction. Shared by the authenticated POST /api/v1/leads route
 * and external ingestion webhooks (e.g. IndiaMART) so both paths stay in
 * sync on what "a new lead" means, instead of duplicating this logic.
 *
 * Before creating, checks for an existing open lead with the same contactId.
 * If found, returns { duplicate: true, existingLead } instead of creating.
 */
export async function createLeadWithDefaults(input: CreateLeadInput): Promise<CreateLeadResult> {
  const now = new Date()
  const stage = 'New Lead'

  return prisma.$transaction(async (tx) => {
    // Duplicate check: if this contact already has an open lead in the org,
    // return the existing one instead of creating a second — unless the
    // caller explicitly opted into "log as repeat enquiry" (allowRepeat).
    if (!input.allowRepeat) {
      const existingLead = await tx.lead.findFirst({
        where: {
          orgId: input.orgId,
          contactId: input.contactId,
          stage: {
            notIn: ['Order Confirmed', 'Order Closed', 'Deal Lost', 'Disqualified', 'Closed Won'],
          },
        },
        select: {
          id: true,
          orgId: true,
          companyName: true,
          stage: true,
          assignedTo: { select: { fullName: true } },
        },
      })

      if (existingLead) {
        return { duplicate: true, existingLead }
      }
    }

    // Explicit assignee wins; otherwise fall back to auto-assignment
    // (round-robin by capacity) when enabled in Settings.
    const assignedToId =
      input.assignedToId ??
      (await pickAssignee(tx, input.orgId, {
        source: input.source,
        sourceDetails: input.sourceDetails,
        at: now,
      }))

    const orgStages = await tx.settings.findUnique({
      where: { orgId: input.orgId },
      select: { workflowStages: true },
    })
    const { normalizeWorkflowStages } = await import('./workflow-stages')
    const newLeadSlaHours = normalizeWorkflowStages(orgStages?.workflowStages).find(
      (s) => s.name === stage
    )?.slaHours

    const created = await tx.lead.create({
      data: {
        ...(assignedToId && { assignedToId, assignedAt: now }),
        orgId: input.orgId,
        contactId: input.contactId,
        companyName: input.companyName,
        priority: input.priority || 'Medium',
        notes: input.notes,
        source: input.source,
        sourceDetails: input.sourceDetails,
        externalId: input.externalId,
        tags: input.tags || [],
        closingHorizon: input.closingHorizon,
        targetClosingDate: input.targetClosingDate,
        territory: input.territory,
        serviceArea: input.serviceArea,
        pinCode: input.pinCode,
        quotationValue: input.quotationValue,
        orderValue: input.orderValue,
        customerSegment: input.customerSegment,
        productCategory: input.productCategory,
        requirement: input.requirement,
        quotationNumber: input.quotationNumber,
        supplierMargin: input.supplierMargin,
        stage,
        stageChangedAt: now,
        slaCreatedAt: now,
        slaDeadline: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // overwritten below
        createdById: input.createdById,
      },
    })

    const { deadline } = await startSlaClock({
      db: tx,
      orgId: input.orgId,
      entityType: 'Lead',
      entityId: created.id,
      stage,
      trigger: 'stage_entered',
      startAt: now,
      fallbackHours: newLeadSlaHours,
    })
    if (deadline) {
      await tx.lead.update({ where: { id: created.id }, data: { slaDeadline: deadline } })
    }

    await createSopChecklistsForStage(tx, created.id, stage, input.creatorRole)

    await tx.timeline.create({
      data: {
        orgId: input.orgId,
        leadId: created.id,
        events: {
          create: {
            type: 'lead_created',
            title: 'Lead created',
            description: `Lead created for ${input.companyName}`,
            createdBy: input.createdById,
          },
        },
      },
    })

    return { duplicate: false, lead: created }
  })
}
