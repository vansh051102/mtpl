'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { api } from '@/lib/api-client'
import { EmptyState } from '@/components/dashboards/shared/EmptyState'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  createdAt: string
  leadId: string | null
}

const POLL_MS = 60_000

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    function load() {
      api
        .get<{ notifications: NotificationRow[]; unreadCount: number }>('/notifications?limit=10')
        .then((res) => {
          if (cancelled || !res.data) return
          setNotifications(res.data.notifications)
          setUnreadCount(res.data.unreadCount)
        })
        .catch(() => undefined)
    }
    load()
    const interval = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  async function openNotification(n: NotificationRow) {
    if (!n.read) {
      await api.patch(`/notifications/${n.id}/read`).catch(() => undefined)
      setUnreadCount((c) => Math.max(0, c - 1))
    }
    setOpen(false)
    if (n.leadId) router.push(`/leads/${n.leadId}`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-foreground hover:bg-muted"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-apple-red px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-[28px] border border-border bg-white/90 p-2 shadow-apple-float backdrop-blur-md dark:bg-black/70">
            {notifications.length === 0 ? (
              <EmptyState message="No notifications." />
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm hover:bg-muted ${n.read ? 'opacity-60' : ''}`}
                    >
                      <span className="font-medium text-foreground">{n.title}</span>
                      <span className="text-xs text-muted-foreground">{n.body}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
