'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { api } from '@/lib/api-client'

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'This Week' },
  { value: '30d', label: 'This Month' },
]

interface UserOption {
  id: string
  fullName: string
  department: string | null
  branch: string | null
}

/** URL-param-backed filters (?range=&salespersonId=&branch=) — shareable/bookmarkable,
 * consumed by whatever data hook the page composes it with. */
export function GlobalFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [users, setUsers] = useState<UserOption[]>([])

  useEffect(() => {
    api
      .get<UserOption[]>('/users')
      .then((res) => setUsers(res.data ?? []))
      .catch(() => undefined)
  }, [])

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  const branches = [...new Set(users.map((u) => u.branch).filter((b): b is string => Boolean(b)))]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={searchParams.get('range') ?? 'today'}
        onChange={(e) => setParam('range', e.target.value)}
        className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground"
      >
        {RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get('salespersonId') ?? ''}
        onChange={(e) => setParam('salespersonId', e.target.value)}
        className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground"
      >
        <option value="">All salespeople</option>
        {users
          .filter((u) => u.department === 'Sales')
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
      </select>

      <select
        value={searchParams.get('branch') ?? ''}
        onChange={(e) => setParam('branch', e.target.value)}
        className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm text-foreground"
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
    </div>
  )
}
