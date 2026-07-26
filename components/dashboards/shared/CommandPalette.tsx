'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api-client'
import type { SearchResult } from '@/app/api/v1/search/route'

export const COMMAND_PALETTE_OPEN_EVENT = 'mtpl-os:open-command-palette'

const STATIC_ACTIONS = [
  { label: "Today's Leads", href: '/leads' },
  { label: 'Pending RFQs', href: '/purchase?status=pending' },
  { label: 'Employees', href: '/employees/command-center' },
]

/** macOS Spotlight-style glass modal, Cmd+K / Ctrl+K to open. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onOpenEvent() {
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent)
    }
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .get<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!cancelled) setResults(res.data ?? [])
        })
        .catch(() => undefined)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  if (!open) return null

  function go(href: string) {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  const filteredActions = STATIC_ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-[28px] border border-border bg-white/90 p-2 shadow-apple-float backdrop-blur-md dark:bg-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads, customers, suppliers, employees…"
          className="w-full rounded-2xl border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none"
        />
        {(filteredActions.length > 0 || results.length > 0) && (
          <ul className="max-h-80 overflow-y-auto border-t border-border">
            {filteredActions.map((a) => (
              <li key={a.href}>
                <button
                  type="button"
                  onClick={() => go(a.href)}
                  className="flex w-full items-center px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  {a.label}
                </button>
              </li>
            ))}
            {results.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <button
                  type="button"
                  onClick={() => go(r.href)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  <span>{r.label}</span>
                  <span className="text-xs capitalize text-muted-foreground">{r.type.replace('_', ' ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
