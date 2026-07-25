'use client'

import { supabaseBrowser } from './supabase-browser'

export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown, public code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  pagination?: { page: number; limit: number; total: number; totalPages: number }
  error?: { code: string; message: string; details?: unknown }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession()

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
      ...init?.headers,
    },
  })

  const body = (await res.json()) as ApiEnvelope<T>

  if (!res.ok || !body.success) {
    throw new ApiError(res.status, body.error?.message || 'Request failed', body.error?.details, body.error?.code)
  }

  return body
}

// Multipart upload: sends FormData with no explicit Content-Type so the browser
// sets the multipart boundary itself. Used for lead document uploads.
async function uploadRequest<T>(path: string, form: FormData): Promise<ApiEnvelope<T>> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession()

  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    body: form,
    headers: {
      ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
    },
  })

  const body = (await res.json()) as ApiEnvelope<T>
  if (!res.ok || !body.success) {
    throw new ApiError(res.status, body.error?.message || 'Request failed', body.error?.details, body.error?.code)
  }
  return body
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => uploadRequest<T>(path, form),
  /** Fetch a binary API response (e.g. PDF). */
  async fetchBlob(path: string): Promise<Blob> {
    const {
      data: { session },
    } = await supabaseBrowser.auth.getSession()

    const res = await fetch(`/api/v1${path}`, {
      headers: {
        ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
      },
    })

    if (!res.ok) {
      let message = 'Could not load file'
      try {
        const body = (await res.json()) as ApiEnvelope<unknown>
        message = body.error?.message || message
      } catch {
        /* binary error body */
      }
      throw new ApiError(res.status, message)
    }

    return res.blob()
  },
}
