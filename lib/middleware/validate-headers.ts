// ============================================================================
// REQUEST VALIDATION MIDDLEWARE
// ============================================================================
// Re-verifies the user identity from the database instead of blindly trusting
// headers set by middleware.ts. This is the critical security boundary:
//
//   middleware.ts (Edge Runtime)
//     → may set x-user-id / x-org-id from a short-lived session cache
//
//   API routes (Node Runtime)
//     → validateRequest(req) resolves user from headers OR Bearer token
//     → caches the DB user row briefly so parallel leads/stats/me calls
//       don't each pay a Prisma round-trip
//
// Usage in API routes:
//   export const GET = withErrorHandler(async (req) => {
//     const ctx = await validateRequest(req)
//     // ctx.userId, ctx.orgId, ctx.user, ctx.role are DB-verified
//   })

import { prisma } from '@/lib/db'
import { supabase } from '@/lib/supabase-clients'
import { UnauthorizedError } from '@/lib/api-response'
import { isAuthDisabled } from '@/lib/dev-auth'
import { resolveDevBypassUser } from '@/lib/dev-bootstrap'

export interface RequestContext {
  userId: string
  orgId: string
  role: string
  department: string | null
  designation: string | null
  user: {
    id: string
    email: string
    fullName: string
    role: string
    status: string
    department: string | null
    designation: string | null
    isSuperAdmin: boolean
  }
}

const USER_TTL_MS = 30_000
const userCache = new Map<string, { ctx: RequestContext; expires: number }>()
const userInflight = new Map<string, Promise<RequestContext>>()
const tokenUserCache = new Map<string, { userId: string; expires: number }>()

async function loadUserContext(userId: string, expectedOrgId?: string | null): Promise<RequestContext> {
  const hit = userCache.get(userId)
  if (hit && hit.expires > Date.now()) {
    if (expectedOrgId && hit.ctx.orgId !== expectedOrgId) {
      throw new UnauthorizedError('Organization mismatch — possible session hijacking')
    }
    return hit.ctx
  }

  const pending = userInflight.get(userId)
  if (pending) {
    const ctx = await pending
    if (expectedOrgId && ctx.orgId !== expectedOrgId) {
      throw new UnauthorizedError('Organization mismatch — possible session hijacking')
    }
    return ctx
  }

  const promise = (async (): Promise<RequestContext> => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        orgId: true,
        department: true,
        designation: true,
        isSuperAdmin: true,
      },
    })

    if (!user) {
      throw new UnauthorizedError('User not found — account may have been deleted')
    }
    if (user.status !== 'active') {
      throw new UnauthorizedError(`Account is ${user.status} — contact your administrator`)
    }

    // Presence signal for the CEO Command Center's live employee status: this
    // runs once per USER_TTL_MS window (cache hits above skip straight past
    // it), so it's a cheap way to know "active in the last 30s" without a
    // dedicated heartbeat endpoint. Never blocks the response on failure.
    prisma.user
      .update({ where: { id: userId }, data: { lastLogin: new Date(), liveAvailability: 'ONLINE' } })
      .catch(() => {})

    const ctx: RequestContext = {
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
      department: user.department,
      designation: user.designation,
      user,
    }
    userCache.set(userId, { ctx, expires: Date.now() + USER_TTL_MS })
    return ctx
  })().finally(() => {
    userInflight.delete(userId)
  })

  userInflight.set(userId, promise)
  const ctx = await promise
  if (expectedOrgId && ctx.orgId !== expectedOrgId) {
    throw new UnauthorizedError('Organization mismatch — possible session hijacking')
  }
  return ctx
}

async function resolveUserIdFromBearer(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token) return null

  const cached = tokenUserCache.get(token)
  if (cached && cached.expires > Date.now()) return cached.userId

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return null

  tokenUserCache.set(token, { userId: user.id, expires: Date.now() + USER_TTL_MS })
  return user.id
}

/**
 * Validate the current request by re-verifying the user from the database.
 *
 * Accepts either middleware headers (x-user-id / x-org-id) or an Authorization
 * Bearer token from the browser API client.
 */
export async function validateRequest(req: Request): Promise<RequestContext> {
  let userId = req.headers.get('x-user-id')
  let orgId = req.headers.get('x-org-id')

  if ((!userId || !orgId) && isAuthDisabled()) {
    const bypass = await resolveDevBypassUser()
    if (bypass) {
      userId = bypass.id
      orgId = bypass.orgId
    }
  }

  if (!userId) {
    userId = await resolveUserIdFromBearer(req)
  }

  if (!userId) {
    throw new UnauthorizedError('Missing user context — sign in again')
  }

  return loadUserContext(userId, orgId)
}

/**
 * Validate request and require a specific role.
 * Use for admin-only or role-gated endpoints.
 */
export async function validateRequestWithRole(
  req: Request,
  allowedRoles: string[]
): Promise<RequestContext> {
  const ctx = await validateRequest(req)
  if (!allowedRoles.includes(ctx.role)) {
    throw new UnauthorizedError(`This endpoint requires one of: ${allowedRoles.join(', ')}`)
  }
  return ctx
}
