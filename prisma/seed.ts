import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Create or find test org
  const org = await prisma.organization.upsert({
    where: { slug: 'test-org' },
    update: {},
    create: {
      name: 'Test Organization',
      slug: 'test-org',
      subscriptionPlan: 'pro',
    },
  })

  console.log(`✓ Organization: ${org.name}`)

  // Create test users with different roles
  const adminUser = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'admin@test.com' } },
    update: {},
    create: {
      orgId: org.id,
      email: 'admin@test.com',
      fullName: 'Admin User',
      role: 'admin',
      status: 'active',
    },
  })

  const marketingExec = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'marketing@test.com' } },
    update: {},
    create: {
      orgId: org.id,
      email: 'marketing@test.com',
      fullName: 'Marketing Executive',
      role: 'marketing_executive',
      department: 'Marketing',
      status: 'active',
    },
  })

  const salesExec = await prisma.user.upsert({
    where: { orgId_email: { orgId: org.id, email: 'sales@test.com' } },
    update: {},
    create: {
      orgId: org.id,
      email: 'sales@test.com',
      fullName: 'Sales Executive',
      role: 'sales_executive',
      department: 'Sales',
      status: 'active',
    },
  })

  console.log(`✓ Users: admin, marketing_exec, sales_exec`)

  // Create test contacts. findFirst + create rather than upsert-by-compound-
  // unique: (orgId,email) is now a partial index (WHERE deletedAt IS NULL,
  // see migration 20260726000000), which Prisma can't express as a named
  // compound-unique input.
  const contact1 =
    (await prisma.contact.findFirst({ where: { orgId: org.id, email: 'john@acme.com', deletedAt: null } })) ??
    (await prisma.contact.create({
      data: {
        orgId: org.id,
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@acme.com',
        phone: '+1-555-1234',
        source: 'Website',
        createdById: adminUser.id,
      },
    }))

  const contact2 =
    (await prisma.contact.findFirst({ where: { orgId: org.id, email: 'jane@widgets.com', deletedAt: null } })) ??
    (await prisma.contact.create({
      data: {
        orgId: org.id,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@widgets.com',
        phone: '+1-555-5678',
        source: 'LinkedIn',
        createdById: adminUser.id,
      },
    }))

  console.log(`✓ Contacts: john@acme.com, jane@widgets.com`)

  const now = new Date()
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Create test leads in various stages
  await prisma.lead.create({
    data: {
      orgId: org.id,
      contactId: contact1.id,
      companyName: 'Acme Corp',
      stage: 'New Lead',
      priority: 'High',
      status: 'open',
      source: 'Website',
      slaCreatedAt: now,
      slaDeadline: tomorrow,
      createdById: adminUser.id,
      assignedToId: marketingExec.id,
    },
  })

  await prisma.lead.create({
    data: {
      orgId: org.id,
      contactId: contact2.id,
      companyName: 'Widgets Inc',
      stage: 'Qualified',
      priority: 'Medium',
      status: 'open',
      source: 'LinkedIn',
      qualifiedAt: now,
      slaCreatedAt: now,
      slaDeadline: tomorrow,
      createdById: adminUser.id,
      assignedToId: salesExec.id,
    },
  })

  await prisma.lead.create({
    data: {
      orgId: org.id,
      contactId: contact1.id,
      companyName: 'Acme Corp - Phase 2',
      stage: 'Quote Sent',
      priority: 'High',
      status: 'open',
      source: 'Referral',
      qualifiedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      quoteSentAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      quotationNumber: 'QT-2026-001',
      quotationValue: '50000.00',
      slaCreatedAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      slaDeadline: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      createdById: adminUser.id,
      assignedToId: salesExec.id,
    },
  })

  console.log(`✓ Leads: 3 leads in New Lead/Qualified/Quote Sent stages`)

  // Create settings for the org
  await prisma.settings.upsert({
    where: { orgId: org.id },
    update: {},
    create: {
      orgId: org.id,
      autoAssignmentEnabled: true,
      autoAssignmentRule: { rule_type: 'least_open_leads' },
      workflowStages: ['New Lead', 'Qualified', 'Quote Sent', 'Negotiation', 'Won', 'Lost'],
      updatedBy: adminUser.id,
    },
  })

  console.log(`✓ Organization settings created`)

  // Create default roles
  await prisma.role.upsert({
    where: { orgId_name: { orgId: org.id, name: 'admin' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'admin',
      permissions: ['*'],
      description: 'Admin with full access',
    },
  })

  await prisma.role.upsert({
    where: { orgId_name: { orgId: org.id, name: 'marketing_executive' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'marketing_executive',
      permissions: [
        'leads:read',
        'leads:create',
        'leads:edit',
        'contacts:read',
        'contacts:create',
        'activities:create',
        'activities:read',
      ],
      description: 'Marketing executive permissions',
    },
  })

  await prisma.role.upsert({
    where: { orgId_name: { orgId: org.id, name: 'sales_executive' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'sales_executive',
      permissions: [
        'leads:read',
        'leads:edit',
        'contacts:read',
        'activities:create',
        'activities:read',
        'quotes:read',
      ],
      description: 'Sales executive permissions',
    },
  })

  console.log(`✓ Roles: admin, marketing_executive, sales_executive`)

  console.log(`\n✅ Seed complete! Database ready for testing.`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
