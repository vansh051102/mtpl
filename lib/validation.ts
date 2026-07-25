import { z } from 'zod'
import { PERMISSIONS } from './permissions'
import { CALL_OUTCOMES, DISQUALIFIED_REASONS } from './lead-stages'

// ============================================================================
// AUTH VALIDATION
// ============================================================================

export const SignUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  orgName: z.string().min(2, 'Organization name is required'),
})

export const SignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type SignUpInput = z.infer<typeof SignUpSchema>
export type SignInInput = z.infer<typeof SignInSchema>

// ============================================================================
// CONTACT VALIDATION (Phase 1)
// ============================================================================

export const CreateContactSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().regex(/^\+?[0-9\-\s()]+$/, 'Invalid phone number'),
  alternatePhone: z.string().regex(/^\+?[0-9\-\s()]+$/, 'Invalid phone number').optional(),
  designation: z.string().optional(),
  gstNumber: z.string().optional(),
  source: z.enum([
    'Website',
    'LinkedIn',
    'Referral',
    'Email',
    'Phone',
    'Other',
  ]).default('Other'),
  sourceDetails: z.record(z.any()).optional(),
  tags: z.array(z.string()).default([]),
})

export const UpdateContactSchema = CreateContactSchema.partial()

export type CreateContactInput = z.infer<typeof CreateContactSchema>
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>

// ============================================================================
// CONTACT LEAD-GEN WORKFLOW VALIDATION (Call Log / Reminder / Disqualify)
// ============================================================================

export const LogContactCallSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  duration: z.number().positive().optional(),
  notes: z.string().optional(),
  clientMutationId: z.string().optional(),
  expectedVersion: z.number().int().optional(),
})

export const SetContactReminderSchema = z.object({
  dueDate: z.coerce.date(),
  timeZone: z.string().default('Asia/Kolkata'),
  note: z.string().optional(),
  clientMutationId: z.string().optional(),
  expectedVersion: z.number().int().optional(),
})

export const DisqualifyContactSchema = z
  .object({
    reason: z.enum(DISQUALIFIED_REASONS),
    details: z.string().optional(),
    expectedVersion: z.number().int().optional(),
  })
  .refine(
    (data) => {
      if (data.reason === 'Other') {
        return Boolean(data.details && data.details.trim().length >= 20)
      }
      return true
    },
    { message: 'Details must be at least 20 characters when reason is "Other"' }
  )

export const UnmaskContactFieldSchema = z.object({
  field: z.enum(['phone', 'email', 'gstNumber']),
  reason: z.string().optional(),
})

// CTI (call telephony) webhook receiver — provider-agnostic shape (Gap 15).
export const CtiWebhookSchema = z.object({
  externalCallId: z.string().min(1),
  phone: z.string().min(1),
  durationSeconds: z.number().int().min(0),
  status: z.enum(['COMPLETED', 'MISSED', 'BUSY', 'BLOCKED']),
  recordingUrl: z.string().url().optional(),
})

export type LogContactCallInput = z.infer<typeof LogContactCallSchema>
export type SetContactReminderInput = z.infer<typeof SetContactReminderSchema>
export type DisqualifyContactInput = z.infer<typeof DisqualifyContactSchema>
export type UnmaskContactFieldInput = z.infer<typeof UnmaskContactFieldSchema>

// ============================================================================
// LEAD VALIDATION (Phase 1)
// ============================================================================

export const LEAD_STAGES = [
  'New Lead',
  'Contacted',
  'Qualified',
  'Quote Sent',
  'Order Confirmed',
  'Order Closed',
  'Deal Lost',
  'Disqualified',
] as const

export const LEAD_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const

export const CLOSING_HORIZONS = [
  'next_2_days',
  'next_3_days',
  '1_week',
  '1_month',
  'custom',
] as const

export const CUSTOMER_SEGMENTS = [
  'Trader',
  'Dealer',
  'Fabricator',
  'Contractor',
  'Infrastructure/Builder',
  'Industrial End-User',
  'Government/PSU',
] as const

// UI-suggested only — Lead.productCategory stays a free-text column
// (matched with `contains`), so these are convenience options, not an enum.
// Shared by components/new-lead-form.tsx and app/(app)/leads/page.tsx.
export const PRODUCT_CATEGORIES = [
  'Pipes',
  'Roofing Sheets',
  'Structural Steel',
  'Flat Products',
  'Polycarbonate',
  'Decking',
  'C & Z Purlins',
  'Fasteners/Accessories',
] as const

export const CreateLeadSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
  companyName: z.string().min(1, 'Company name is required'),
  priority: z.enum(LEAD_PRIORITIES).default('Medium'),
  notes: z.string().optional(),
  // Free-text customer requirement shown/edited in the "Requirements" tab.
  requirement: z.string().optional(),
  source: z.string().optional(),
  sourceDetails: z.record(z.any()).optional(),
  tags: z.array(z.string()).default([]),
  closingHorizon: z.enum(CLOSING_HORIZONS).optional(),
  targetClosingDate: z.coerce.date().optional(),
  territory: z.string().optional(),
  serviceArea: z.string().optional(),
  // Indian PIN codes: 6 digits, first digit non-zero. Nullable (not just
  // optional) — clearing the field, or reading a pre-existing lead with a
  // legacy free-text value, must not trip validation.
  pinCode: z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid PIN code').nullable().optional(),
  productCategory: z.string().optional(),
  // Nullable (not just optional): clearing an existing lead's segment, or
  // reading/updating leads created before this column existed, must not
  // trip validation.
  customerSegment: z.enum(CUSTOMER_SEGMENTS).nullable().optional(),
})

export const UpdateLeadSchema = CreateLeadSchema.partial().extend({
  // Optimistic lock: when provided, the update is rejected with a 409 if it
  // no longer matches the server's Lead.version (someone else updated first).
  version: z.number().int().optional(),
})

export const UpdateLeadStageSchema = z
  .object({
    stage: z.enum(LEAD_STAGES),
    reason: z.string().optional(),
    reasonDetails: z.string().optional(),
    assignedToId: z.string().uuid('Invalid user ID').optional(),
    // Quote Sent details (required when stage = "Quote Sent")
    supplierMargin: z.number().min(0).max(100).optional(),
    quotationNumber: z.string().optional(),
    productCategory: z.string().optional(),
    quotationValue: z.number().positive().optional(),
    version: z.number().int().optional(),
  })
  .refine(
    (data) => {
      if (data.stage === 'Quote Sent') {
        return (
          data.supplierMargin !== undefined &&
          data.quotationNumber !== undefined &&
          data.quotationNumber.trim().length > 0 &&
          data.productCategory !== undefined &&
          data.productCategory.trim().length > 0 &&
          data.quotationValue !== undefined
        )
      }
      return true
    },
    {
      message:
        'Supplier margin, quotation number, product category, and quotation value are required when moving to Quote Sent',
    }
  )
  .refine(
    (data) => {
      if (
        (data.stage === 'Deal Lost' || data.stage === 'Disqualified') &&
        data.reason === 'Other'
      ) {
        return Boolean(data.reasonDetails && data.reasonDetails.trim().length >= 20)
      }
      return true
    },
    { message: 'Details must be at least 20 characters when reason is "Other"' }
  )

export const AssignLeadSchema = z.object({
  assignedToId: z.string().uuid('Invalid user ID'),
  version: z.number().int().optional(),
})

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>
export type UpdateLeadInput = z.infer<typeof UpdateLeadSchema>
export type UpdateLeadStageInput = z.infer<typeof UpdateLeadStageSchema>
export type AssignLeadInput = z.infer<typeof AssignLeadSchema>

// ============================================================================
// ACTIVITY VALIDATION (Phase 1)
// ============================================================================

export const ACTIVITY_TYPES = [
  'call',
  'email',
  'note',
  'meeting',
  'task',
  'message', // WhatsApp/SMS/email logged via "Log a Message"
  'reminder', // scheduled follow-up logged via "Log a Reminder"
] as const
export const ACTIVITY_STATUSES = ['pending', 'completed', 'cancelled'] as const

// Known keys dashboards/reports aggregate on (project specifics tracked per
// enquiry/activity) — kept as named, typed fields so aggregation reads
// structured data. `.catchall` still allows other free-form keys (e.g. the
// existing `outcome`/`emailTo`/`attendees` used by lead-activities.tsx).
export const ActivityMetadataSchema = z
  .object({
    projectType: z.string().optional(),
    material: z.string().optional(),
    quotationNumber: z.string().optional(),
    deliveryArea: z.string().optional(),
  })
  .catchall(z.any())

export const CreateActivitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  // z.coerce.date() accepts ISO strings over JSON (z.date() would reject them)
  scheduledFor: z.coerce.date().optional(),
  duration: z.number().positive().optional(),
  status: z.enum(ACTIVITY_STATUSES).default('pending'),
  metadata: ActivityMetadataSchema.optional(),
})

export const UpdateActivitySchema = CreateActivitySchema.partial()

export type CreateActivityInput = z.infer<typeof CreateActivitySchema>
export type UpdateActivityInput = z.infer<typeof UpdateActivitySchema>

// ============================================================================
// CHECKLIST VALIDATION (Phase 1)
// ============================================================================

export const CreateChecklistSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  isRequired: z.boolean().default(false),
  items: z
    .array(
      z.object({
        title: z.string().min(1, 'Item title is required'),
      })
    )
    .default([]),
})

export const UpdateChecklistSchema = CreateChecklistSchema.partial()

export const ChecklistItemSchema = z.object({
  completed: z.boolean(),
})

export type CreateChecklistInput = z.infer<typeof CreateChecklistSchema>
export type UpdateChecklistInput = z.infer<typeof UpdateChecklistSchema>

// ============================================================================
// QUOTE VALIDATION (Phase 1)
// ============================================================================

export const CreateQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Product ID is required'),
        quantity: z.number().positive('Quantity must be positive'),
        price: z.number().positive('Price must be positive'),
        discount: z.number().nonnegative('Discount cannot be negative').default(0),
      })
    )
    .min(1, 'At least one item is required'),
  // z.coerce.date() accepts ISO strings over JSON (z.date() would reject them)
  validUntil: z.coerce.date().refine((d) => d > new Date(), 'Validity date must be in the future'),
  terms: z.string().optional(),
  notes: z.string().optional(),
})

export const UpdateQuoteSchema = CreateQuoteSchema.omit({ validUntil: true })
  .partial()
  .extend({
    validUntil: z.coerce.date().optional(),
  })

export const SendQuoteSchema = z.object({
  recipientEmail: z.string().email('Invalid email'),
  message: z.string().optional(),
})

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteSchema>
export type SendQuoteInput = z.infer<typeof SendQuoteSchema>

// ============================================================================
// PURCHASE REQUEST VALIDATION (Phase 1)
// ============================================================================

export const CreatePurchaseRequestSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1, 'At least one product is required'),
  estimatedQuantity: z.number().positive('Quantity must be positive'),
  estimatedAmount: z.number().positive('Amount must be positive'),
  notes: z.string().optional(),
})

export const UpdatePurchaseRequestSchema = CreatePurchaseRequestSchema.partial()

export type CreatePurchaseRequestInput = z.infer<typeof CreatePurchaseRequestSchema>
export type UpdatePurchaseRequestInput = z.infer<typeof UpdatePurchaseRequestSchema>

// ============================================================================
// INDIAMART WEBHOOK VALIDATION (Push API)
// ============================================================================
// Mirrors the RESPONSE object shape from IndiaMART's Lead Manager Push API.
// See: https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads/
// Only UNIQUE_QUERY_ID, QUERY_TYPE, QUERY_TIME, SENDER_NAME, SENDER_COUNTRY_ISO,
// and (SENDER_MOBILE or SENDER_EMAIL) are guaranteed present per their docs;
// everything else is optional and treated as best-effort enrichment.

export const IndiaMartLeadResponseSchema = z
  .object({
    UNIQUE_QUERY_ID: z.string().min(1),
    QUERY_TYPE: z.string().min(1),
    QUERY_TIME: z.string().min(1),
    SENDER_NAME: z.string().default('IndiaMART Buyer'),
    SENDER_MOBILE: z.string().optional(),
    SENDER_EMAIL: z.string().optional(),
    SUBJECT: z.string().optional(),
    SENDER_COMPANY: z.string().optional(),
    SENDER_ADDRESS: z.string().optional(),
    SENDER_CITY: z.string().optional(),
    SENDER_STATE: z.string().optional(),
    SENDER_PINCODE: z.string().optional(),
    SENDER_COUNTRY_ISO: z.string().optional(),
    SENDER_MOBILE_ALT: z.string().optional(),
    SENDER_PHONE: z.string().optional(),
    SENDER_PHONE_ALT: z.string().optional(),
    SENDER_EMAIL_ALT: z.string().optional(),
    QUERY_PRODUCT_NAME: z.string().optional(),
    QUERY_MESSAGE: z.string().optional(),
    QUERY_MCAT_NAME: z.string().optional(),
    CALL_DURATION: z.string().optional(),
    RECEIVER_MOBILE: z.string().optional(),
  })
  .refine((data) => Boolean(data.SENDER_MOBILE || data.SENDER_EMAIL), {
    message: 'Either SENDER_MOBILE or SENDER_EMAIL must be present',
  })

export const IndiaMartWebhookSchema = z.object({
  CODE: z.number().optional(),
  STATUS: z.string().optional(),
  RESPONSE: IndiaMartLeadResponseSchema,
})

export type IndiaMartLeadResponse = z.infer<typeof IndiaMartLeadResponseSchema>

// ============================================================================
// SENDGRID INBOUND PARSE WEBHOOK VALIDATION
// ============================================================================
// SendGrid posts inbound mail as multipart/form-data (or urlencoded); fields
// below are the ones we read. See:
// https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook

export const SendGridInboundSchema = z.object({
  from: z.string().min(1, 'from is required'),
  to: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  envelope: z.string().optional(),
})

export type SendGridInboundInput = z.infer<typeof SendGridInboundSchema>

// ============================================================================
// JUST DIAL LEAD MANAGER VALIDATION (pull API)
// ============================================================================
// Mirrors a single lead entry from JustDial's Lead Manager API response.

export const JustDialLeadSchema = z.object({
  lead_id: z.string().min(1),
  name: z.string().default('JustDial Buyer'),
  mobile: z.string().optional(),
  email: z.string().optional(),
  company_name: z.string().optional(),
  city: z.string().optional(),
  message: z.string().optional(),
  category: z.string().optional(),
  received_at: z.string().optional(),
}).refine((data) => Boolean(data.mobile || data.email), {
  message: 'Either mobile or email must be present',
})

export type JustDialLead = z.infer<typeof JustDialLeadSchema>

// ============================================================================
// TRADEINDIA WEBHOOK VALIDATION (push API)
// ============================================================================
// ponytail: TradeIndia's exact push-webhook payload isn't confirmed yet —
// field names are a best-effort guess mirroring IndiaMART's shape (the two
// B2B marketplaces publish similar lead fields). Tighten once real payloads
// are seen from TradeIndia's dashboard.

export const TradeIndiaLeadSchema = z
  .object({
    QUERY_ID: z.string().min(1),
    SENDER_NAME: z.string().default('TradeIndia Buyer'),
    SENDER_MOBILE: z.string().optional(),
    SENDER_EMAIL: z.string().optional(),
    SENDER_COMPANY: z.string().optional(),
    SENDER_CITY: z.string().optional(),
    SENDER_STATE: z.string().optional(),
    PRODUCT_NAME: z.string().optional(),
    QUERY_MESSAGE: z.string().optional(),
  })
  .refine((data) => Boolean(data.SENDER_MOBILE || data.SENDER_EMAIL), {
    message: 'Either SENDER_MOBILE or SENDER_EMAIL must be present',
  })

export type TradeIndiaLead = z.infer<typeof TradeIndiaLeadSchema>

// ============================================================================
// WHATSAPP BUSINESS (Meta Cloud API) WEBHOOK VALIDATION
// ============================================================================
// Mirrors the subset of Meta's Cloud API "messages" webhook payload we read
// to capture an inbound WhatsApp message as a lead.
// See: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks

const WhatsAppContactSchema = z.object({
  profile: z.object({ name: z.string().optional() }).optional(),
  wa_id: z.string(),
})

const WhatsAppMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
})

export const WhatsAppWebhookSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            contacts: z.array(WhatsAppContactSchema).optional(),
            messages: z.array(WhatsAppMessageSchema).optional(),
          }),
        })
      ),
    })
  ),
})

export type WhatsAppWebhookInput = z.infer<typeof WhatsAppWebhookSchema>

// ============================================================================
// ASSIGNMENT RULE VALIDATION
// ============================================================================
// Workspace-level auto-assignment rules (admin-only). A rule matches a newly
// created lead by source + optional weekday + optional product category and
// routes it to a specific user.

export const CreateAssignmentRuleSchema = z.object({
  source: z.string().min(1, 'Source is required'),
  // 0=Sunday .. 6=Saturday; null = applies on any day.
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  // null = applies to any product category.
  productCategory: z.string().min(1).nullable().default(null),
  assignedToId: z.string().uuid('Invalid user ID'),
  isActive: z.boolean().default(true),
  priority: z.number().int().nonnegative().default(0),
})

export const UpdateAssignmentRuleSchema = CreateAssignmentRuleSchema.partial()

export type CreateAssignmentRuleInput = z.infer<typeof CreateAssignmentRuleSchema>
export type UpdateAssignmentRuleInput = z.infer<typeof UpdateAssignmentRuleSchema>

// ============================================================================
// USER & ROLE MANAGEMENT VALIDATION
// ============================================================================
// Shared by the org-scoped routes (/users, /roles) and the admin workspace
// routes (/admin/companies/[orgId]/...). Route files may only export handlers,
// so these live here.

export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  role: z.string().min(1, 'Role is required'),
  department: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
})

export const UpdateUserSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  department: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
})

// Only real permission strings are accepted. Wildcards ('*') are implicitly
// rejected because they are not members of PERMISSIONS — admin '*' is granted
// by role name, never stored on a custom role.
const ALL_PERMISSIONS = Object.values(PERMISSIONS) as string[]

export const UpdateRoleSchema = z.object({
  permissions: z
    .array(z.string())
    .min(1, 'At least one permission is required')
    .refine((perms) => perms.every((p) => ALL_PERMISSIONS.includes(p)), {
      message: 'Contains an unknown or disallowed permission',
    }),
  description: z.string().nullable().optional(),
})

export type CreateUserInput = z.infer<typeof CreateUserSchema>
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>

// ============================================================================
// PAGINATION VALIDATION
// ============================================================================

export const PaginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive().max(100)).default('20'),
})

export type PaginationInput = z.infer<typeof PaginationSchema>
