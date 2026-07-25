import { prisma } from './db'
import { createChildLogger } from './logger'

const log = createChildLogger('rbac')

// Re-export for backward compatibility — new code should import from
// permissions.ts or ownership.ts directly.
export { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './permissions'
export {
  buildOwnershipFilter,
  buildOwnershipFilterAsync,
  canAccessLead,
  canAccessContact,
} from './ownership'

// ============================================================================
// PERMISSION LOOKUP (used by auth/me route and RbacService)
// ============================================================================

/**
 * Get the permissions array for a user by looking up their Role record.
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return []

    if (user.role === 'admin') return ['*']

    const role = await prisma.role.findFirst({
      where: { orgId: user.orgId, name: user.role },
    })

    if (!role) return []

    return (role.permissions as string[]) || []
  } catch (error) {
    log.error({ err: error, userId }, 'getUserPermissions failed')
    return []
  }
}
