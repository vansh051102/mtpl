import { prisma } from './db'
import { createChildLogger } from './logger'

const log = createChildLogger('audit')

export async function logAudit(
  orgId: string,
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  resourceName?: string,
  changes?: any,
  ipAddress?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action,
        resourceType,
        resourceId,
        resourceName,
        changes,
        ipAddress,
        // Direct relation alongside the generic resourceType/resourceId
        // pattern above. Bulk import/export audit entries use the literal
        // 'bulk' as resourceId (not a real Lead id) — excluded, or the FK
        // constraint would reject the insert.
        ...(resourceType === 'Lead' && resourceId !== 'bulk' && { leadId: resourceId }),
      },
    })
  } catch (error) {
    log.error({ err: error, action, resourceType, resourceId }, 'audit log write failed')
  }
}
