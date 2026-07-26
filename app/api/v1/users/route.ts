import { prisma } from '@/lib/db'
import { supabaseAdmin, getOrganizationUsers } from '@/lib/auth'
import { PERMISSIONS } from '@/lib/rbac'
import { getUsersOnSameTeam } from '@/lib/ownership'
import { successResponse, withErrorHandler, ValidationError, ConflictError } from '@/lib/api-response'
import { validateRequest } from '@/lib/middleware/validate-headers'
import { rbacService } from '@/lib/services/rbac.service'
import { z } from 'zod'

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  phone: z.string().nullable().optional(),
  role: z.string().min(1, 'Role is required'),
  department: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  territory: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  reportsToId: z.string().uuid().nullable().optional(),
})

// GET /api/v1/users - List users in the caller's org (for assignment pickers etc.)
export const GET = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  const { orgId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.USERS_READ)

  const users = await getOrganizationUsers(orgId)
  // Admins managing members need inactive users too; pickers can filter client-side

  // ?scope=team — restrict to the caller's own Team (assign-to-sales pickers
  // for Lead Gen roles). Falls back to unscoped when the caller has no team.
  const url = new URL(req.url)
  if (url.searchParams.get('scope') === 'team') {
    const teamUserIds = await getUsersOnSameTeam(ctx.userId)
    if (teamUserIds) {
      const teamSet = new Set(teamUserIds)
      return successResponse(users.filter((u) => teamSet.has(u.id)))
    }
  }

  return successResponse(users)
})

// POST /api/v1/users - Create a new user in the organization
export const POST = withErrorHandler(async (req) => {
  const ctx = await validateRequest(req)
  const { orgId } = ctx
  rbacService.requirePermission(await rbacService.getUserPermissions(ctx.userId), PERMISSIONS.USERS_CREATE)

  const body = await req.json()
  const parsed = CreateUserSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('Invalid user data', parsed.error.flatten())
  }

  const {
    email,
    password,
    fullName,
    phone,
    role,
    department,
    designation,
    territory,
    branch,
    reportsToId,
  } = parsed.data

  const existingUser = await prisma.user.findFirst({
    where: { orgId, email },
  })
  if (existingUser) {
    throw new ConflictError('A user with this email already exists in your organization')
  }

  const {
    data: { user: authUser },
    error: authError,
  } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) throw new ValidationError('Failed to create auth user', { message: authError.message })
  if (!authUser) throw new ValidationError('Failed to create auth user')

  // If the Prisma write fails after the Supabase Auth account was already
  // created (DB hiccup, unexpected constraint), roll back the auth account —
  // otherwise it's orphaned: no User row, but the email is now taken in
  // Supabase, so re-inviting the same address fails confusingly instead of
  // just working. Same rollback pattern as lib/auth.ts's signUp().
  try {
    const dbUser = await prisma.user.create({
      data: {
        id: authUser.id,
        email,
        fullName,
        phone: phone || null,
        orgId,
        role,
        department: department || null,
        designation: designation || null,
        territory: territory || null,
        branch: branch || null,
        reportsToId: reportsToId || null,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        department: true,
        designation: true,
        territory: true,
        branch: true,
        reportsToId: true,
        status: true,
        createdAt: true,
      },
    })

    return successResponse(dbUser, { statusCode: 201 })
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch(() => {
      // Best-effort — the Prisma error below is what the caller needs to see.
    })
    throw err
  }
})
