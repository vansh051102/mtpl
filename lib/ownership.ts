import { prisma } from './db'
import { PURCHASE_QUERY_STAGES } from './lead-stages'

/**
 * Sales user IDs that report (directly or indirectly) to `managerId`,
 * plus `managerId` itself. Used so purchase can see leads owned by their
 * designated salespeople (reportsTo hierarchy).
 */
export async function getDescendantUserIds(managerId: string): Promise<string[]> {
  const ids = new Set<string>([managerId])
  let frontier = [managerId]

  // Walk reportsTo tree breadth-first (orgs are small; cap depth for safety)
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const reports = await prisma.user.findMany({
      where: { reportsToId: { in: frontier }, status: 'active' },
      select: { id: true },
    })
    frontier = []
    for (const r of reports) {
      if (!ids.has(r.id)) {
        ids.add(r.id)
        frontier.push(r.id)
      }
    }
  }

  return [...ids]
}

/**
 * For a purchase user: IDs of salespeople they should see.
 * Prefer users who report to this purchase user; if none, fall back to
 * the purchase user's own assigned leads only (self).
 */
export async function getPurchaseSalesScope(purchaseUserId: string): Promise<string[]> {
  const reports = await prisma.user.findMany({
    where: {
      reportsToId: purchaseUserId,
      status: 'active',
      OR: [
        { department: 'Sales' },
        { role: { in: ['sales_executive', 'sales_manager', 'sales_purchase'] } },
      ],
    },
    select: { id: true },
  })

  if (reports.length > 0) {
    const nested: string[] = []
    for (const r of reports) {
      nested.push(...(await getDescendantUserIds(r.id)))
    }
    return [...new Set(nested)]
  }

  // No designated sales reps — only leads explicitly assigned to purchase
  return [purchaseUserId]
}

/**
 * User IDs sharing the viewer's territory (region) or branch (team) — the
 * ABAC scope for marketing_manager's Contact visibility. Returns `null` when
 * the viewer has neither field set, so callers can fall back to the prior
 * org-wide behavior rather than silently scoping to an empty/wrong set for
 * orgs that haven't configured territories yet.
 */
export async function getUsersInSameTerritoryOrBranch(userId: string): Promise<string[] | null> {
  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, territory: true, branch: true },
  })
  if (!viewer || (!viewer.territory && !viewer.branch)) return null

  const peers = await prisma.user.findMany({
    where: {
      orgId: viewer.orgId,
      status: 'active',
      OR: [
        ...(viewer.territory ? [{ territory: viewer.territory }] : []),
        ...(viewer.branch ? [{ branch: viewer.branch }] : []),
      ],
    },
    select: { id: true },
  })
  return peers.map((p) => p.id)
}

/**
 * User IDs sharing the viewer's Team — used to scope the "Assigned to"
 * dropdown so a Lead Gen user can only assign to Sales Executives on their
 * own Team. Returns `null` when the viewer has no team, so callers can fall
 * back to the prior unscoped behavior rather than an empty result.
 */
export async function getUsersOnSameTeam(userId: string): Promise<string[] | null> {
  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { orgId: true, teamId: true },
  })
  if (!viewer || !viewer.teamId) return null

  const peers = await prisma.user.findMany({
    where: { orgId: viewer.orgId, status: 'active', teamId: viewer.teamId },
    select: { id: true },
  })
  return peers.map((p) => p.id)
}

// ============================================================================
// OWNERSHIP FILTERING
// ============================================================================

/**
 * Build a Prisma `where` clause that filters data based on the user's role,
 * department, and ownership. Used to scope queries to only the data the
 * user should see.
 *
 * Returns an object that can be spread into a Prisma `where` clause.
 *
 * Note: `purchase` filter is async-resolved via `buildOwnershipFilterAsync`
 * when reportsTo scope is needed. Sync version uses assigned-to-self only;
 * list routes should prefer the async helper.
 */
export function buildOwnershipFilter(
  userId: string,
  role: string,
  _department: string | null,
  resource: 'leads' | 'contacts' | 'activities' | 'quotes' | 'purchase_requests'
): Record<string, any> {
  switch (role) {
    case 'admin':
      return {}

    case 'marketing_manager':
      if (resource === 'leads') {
        return {
          OR: [{ assignedToId: null }, { assignedTo: { department: 'Marketing' } }],
        }
      }
      // Contacts have no department link — manager sees all org contacts.
      return {}

    case 'marketing_executive':
      if (resource === 'leads') {
        return { assignedToId: userId }
      }
      if (resource === 'activities') {
        return { lead: { assignedToId: userId } }
      }
      if (resource === 'contacts') {
        return { createdById: userId }
      }
      return {}

    case 'sales_manager':
      if (resource === 'leads') {
        return {
          OR: [{ assignedToId: null }, { assignedTo: { department: 'Sales' } }],
        }
      }
      return {}

    case 'sales_executive':
      if (resource === 'leads') {
        return { assignedToId: userId }
      }
      if (resource === 'activities') {
        return { lead: { assignedToId: userId } }
      }
      return {}

    case 'purchase':
      // Sync fallback: own assignments in purchase-visible stages.
      // Prefer buildOwnershipFilterAsync for designated-sales scope.
      if (resource === 'leads') {
        return {
          assignedToId: userId,
          stage: { in: [...PURCHASE_QUERY_STAGES] },
        }
      }
      if (resource === 'quotes' || resource === 'purchase_requests') {
        return {
          lead: {
            assignedToId: userId,
            stage: { in: [...PURCHASE_QUERY_STAGES] },
          },
        }
      }
      return {}

    case 'sales_purchase':
      if (resource === 'leads') {
        return { assignedToId: userId }
      }
      if (resource === 'activities') {
        return { lead: { assignedToId: userId } }
      }
      if (resource === 'quotes' || resource === 'purchase_requests') {
        return { lead: { assignedToId: userId } }
      }
      return {}

    default:
      return { id: '__DENY_ALL__' }
  }
}

/**
 * Async ownership filter — expands purchase visibility to designated sales reps
 * (users with reportsToId = purchase user).
 */
export async function buildOwnershipFilterAsync(
  userId: string,
  role: string,
  department: string | null,
  resource: 'leads' | 'contacts' | 'activities' | 'quotes' | 'purchase_requests'
): Promise<Record<string, any>> {
  // ABAC: marketing_manager's Contact visibility narrows to their own
  // territory/branch peers when either is configured (else org-wide, same
  // as before — see getUsersInSameTerritoryOrBranch's null-fallback comment).
  if (role === 'marketing_manager' && resource === 'contacts') {
    const scope = await getUsersInSameTerritoryOrBranch(userId)
    return scope ? { createdById: { in: scope } } : {}
  }

  if (role !== 'purchase') {
    return buildOwnershipFilter(userId, role, department, resource)
  }

  const salesScope = await getPurchaseSalesScope(userId)
  const stageFilter = { in: [...PURCHASE_QUERY_STAGES] }

  if (resource === 'leads') {
    return {
      stage: stageFilter,
      OR: [
        { assignedToId: { in: salesScope } },
        { assignedToId: userId },
      ],
    }
  }
  if (resource === 'quotes' || resource === 'purchase_requests') {
    return {
      lead: {
        stage: stageFilter,
        OR: [
          { assignedToId: { in: salesScope } },
          { assignedToId: userId },
        ],
      },
    }
  }
  if (resource === 'activities') {
    return {
      lead: {
        stage: stageFilter,
        OR: [
          { assignedToId: { in: salesScope } },
          { assignedToId: userId },
        ],
      },
    }
  }
  return {}
}

/**
 * Check if a user can access a specific contact (for the pre-Lead call-log/
 * reminder/lock workflow, and the post-handoff Lead-linked views sales
 * roles use). marketing_executive: own contacts only. marketing_manager:
 * territory/branch peers, mirroring the async list-level ABAC scope.
 * sales_executive/sales_manager: only contacts linked to one of their own
 * (or department's) leads — a contact with no lead yet hasn't been handed
 * off to sales, so there's nothing for them to own. Other roles (purchase,
 * sales_purchase, admin) stay permissive — no defined Contact ownership
 * model for them yet.
 */
export async function canAccessContact(
  userId: string,
  role: string,
  contactId: string
): Promise<boolean> {
  if (role === 'marketing_executive') {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { createdById: true },
    })
    if (!contact) return false
    return contact.createdById === userId
  }

  if (role === 'marketing_manager') {
    const scope = await getUsersInSameTerritoryOrBranch(userId)
    if (!scope) return true
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { createdById: true },
    })
    if (!contact) return false
    return scope.includes(contact.createdById)
  }

  if (role === 'sales_executive' || role === 'sales_manager') {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { leads: { select: { assignedToId: true } } },
    })
    if (!contact) return false
    if (contact.leads.length === 0) return false

    if (role === 'sales_executive') {
      return contact.leads.some((l) => l.assignedToId === userId)
    }

    for (const l of contact.leads) {
      if (!l.assignedToId) return true
      const assignee = await prisma.user.findUnique({
        where: { id: l.assignedToId },
        select: { department: true },
      })
      if (assignee?.department === 'Sales') return true
    }
    return false
  }

  return true
}

/**
 * Check if a user can access a specific lead (for detail views and edits).
 * Returns true if the user has access based on their role and ownership.
 */
export async function canAccessLead(
  userId: string,
  role: string,
  leadId: string
): Promise<boolean> {
  if (role === 'admin') return true

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { createdById: true, assignedToId: true, stage: true },
  })

  if (!lead) return false

  switch (role) {
    case 'marketing_manager': {
      if (!lead.assignedToId) return true
      const assigneeDept = await prisma.user.findUnique({
        where: { id: lead.assignedToId },
        select: { department: true },
      })
      return assigneeDept?.department === 'Marketing'
    }

    case 'marketing_executive':
      return lead.assignedToId === userId

    case 'sales_manager': {
      if (!lead.assignedToId) return true
      const assignee = await prisma.user.findUnique({
        where: { id: lead.assignedToId },
        select: { department: true },
      })
      return assignee?.department === 'Sales'
    }

    case 'sales_executive':
      return lead.assignedToId === userId

    case 'purchase': {
      if (!PURCHASE_QUERY_STAGES.includes(lead.stage as (typeof PURCHASE_QUERY_STAGES)[number])) {
        return false
      }
      if (lead.assignedToId === userId) return true
      if (!lead.assignedToId) return false
      const salesScope = await getPurchaseSalesScope(userId)
      return salesScope.includes(lead.assignedToId)
    }

    case 'sales_purchase':
      return lead.assignedToId === userId

    default:
      return false
  }
}
