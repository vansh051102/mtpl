import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isAuthDisabled } from '@/lib/dev-auth'

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/signup',
  '/auth/callback',
  '/auth/forgot-password',
  '/auth/inactive',
  '/api/v1/auth/signup',
  '/api/v1/auth/signin',
  '/api/v1/health',
  '/api/internal/session',
  '/api/v1/webhooks',
  '/api/v1/cron',
  '/api/v1/cti',
]

const ADMIN_ROUTES = ['/admin']

type SessionData = {
  id: string
  orgId: string
  role: string
  status: string
  department: string | null
  designation: string | null
}

// Short-lived cache + single-flight so parallel API calls share one
// /api/internal/session round-trip instead of stampeding Prisma.
const SESSION_TTL_MS = 30_000
const sessionCache = new Map<string, { data: SessionData; expires: number }>()

// Three-state result, not two: /api/internal/session's own prisma.user.findUnique
// call shares the same DATABASE_URL pool as every other route, so it can fail
// under load with no signal that the user's Supabase session is actually invalid.
//   - SessionData: resolved successfully
//   - null: a DEFINITIVE answer that there is no valid session (401/404) —
//     redirect to login
//   - undefined: INDETERMINATE — a network error or 5xx (e.g. a pool_timeout).
//     The caller must not treat this as a logout; the Supabase-level session
//     check that runs before this is what actually gates real auth.
type SessionResolution = SessionData | null | undefined
const sessionInflight = new Map<string, Promise<SessionResolution>>()

async function resolveSession(req: NextRequest, accessToken?: string): Promise<SessionResolution> {
  const cacheKey = accessToken ?? '__dev__'
  const hit = sessionCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return hit.data
  }

  const pending = sessionInflight.get(cacheKey)
  if (pending) return pending

  const promise = (async (): Promise<SessionResolution> => {
    try {
      const sessionRes = await fetch(new URL('/api/internal/session', req.url), {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        signal: AbortSignal.timeout(5_000),
      })
      if (sessionRes.ok) {
        const data = (await sessionRes.json()) as SessionData
        sessionCache.set(cacheKey, { data, expires: Date.now() + SESSION_TTL_MS })
        return data
      }
      if (sessionRes.status === 401 || sessionRes.status === 404) {
        // Definitive: no such user / no valid token.
        return null
      }
      // Any other status (5xx from an unhandled DB error, etc.) is a server
      // hiccup, not a real "you're not authenticated" answer.
      console.error(`resolveSession: unexpected status ${sessionRes.status}`)
      return undefined
    } catch (error) {
      // Network-level failure reaching /api/internal/session — also
      // indeterminate, not a definitive "no session."
      console.error('Error resolving session:', error)
      return undefined
    }
  })().finally(() => {
    sessionInflight.delete(cacheKey)
  })

  sessionInflight.set(cacheKey, promise)
  return promise
}

function attachUserHeaders(req: NextRequest, res: NextResponse, sessionData: SessionData) {
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-user-id', sessionData.id)
  requestHeaders.set('x-org-id', sessionData.orgId)
  requestHeaders.set('x-user-role', sessionData.role)
  requestHeaders.set('x-user-department', sessionData.department ?? '')
  requestHeaders.set('x-user-designation', sessionData.designation ?? '')

  const nextRes = NextResponse.next({ request: { headers: requestHeaders } })
  res.cookies.getAll().forEach((cookie) => nextRes.cookies.set(cookie))
  return nextRes
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const pathname = req.nextUrl.pathname

  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return res
  }

  const isApi = pathname.startsWith('/api/')

  // Dev bypass: skip login redirects; always impersonate dev user (ignore stale cookies).
  if (isAuthDisabled()) {
    // API routes: don't block on session HTTP — validateRequest resolves the bypass user.
    if (isApi) {
      const hit = sessionCache.get('__dev__')
      if (hit && hit.expires > Date.now()) {
        return attachUserHeaders(req, res, hit.data)
      }
      void resolveSession(req)
      return res
    }
    const sessionData = await resolveSession(req)
    if (sessionData) {
      return attachUserHeaders(req, res, sessionData)
    }
    return res
  }

  const supabase = createMiddlewareClient(
    { req, res },
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/auth/login', req.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // API fast path: use cached session headers when available. On cache miss,
  // pass through immediately — the route's validateRequest resolves the Bearer
  // token. Warm the cache in the background for the next request.
  if (isApi) {
    const cacheKey = session.access_token
    const hit = sessionCache.get(cacheKey)
    if (hit && hit.expires > Date.now()) {
      return attachUserHeaders(req, res, hit.data)
    }
    void resolveSession(req, session.access_token)
    return res
  }

  const sessionData = await resolveSession(req, session.access_token)

  if (sessionData === null) {
    // Definitive: /api/internal/session said this token has no valid user.
    return NextResponse.redirect(new URL('/auth/login', req.url))
  }

  if (sessionData === undefined) {
    // Indeterminate — a DB hiccup resolving the app-level user record, not a
    // real logout. The Supabase session above is valid, so don't bounce the
    // user to /auth/login over a transient error; pass through unenriched.
    // Any API call this page makes still authenticates independently via
    // validateRequest's Bearer-token fallback (lib/middleware/validate-headers.ts).
    return res
  }

  if (sessionData.status !== 'active') {
    return NextResponse.redirect(new URL('/auth/inactive', req.url))
  }

  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    if (sessionData.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  return attachUserHeaders(req, res, sessionData)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.+\\.\\w+$).*)'],
}
