'use client'

import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  createdAt: string
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)

  async function load() {
    try {
      const res = await api.get<{ notifications: NotificationRow[]; unreadCount: number }>(
        '/notifications?limit=20'
      )
      setNotifications(res.data?.notifications ?? [])
      setUnreadCount(res.data?.unreadCount ?? 0)
    } catch {
      // Silent — the bell degrades to showing nothing rather than erroring the topbar.
    }
  }

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 60_000)
    return () => clearInterval(interval)
  }, [])

  async function markRead(id: string) {
    setNotifications((rows) => rows.map((r) => (r.id === id ? { ...r, read: true } : r)))
    setUnreadCount((c) => Math.max(0, c - 1))
    await api.patch(`/notifications/${id}/read`, {}).catch(() => void load())
  }

  async function markAllRead() {
    setNotifications((rows) => rows.map((r) => ({ ...r, read: true })))
    setUnreadCount(0)
    await api.patch('/notifications/mark-all-read', {}).catch(() => void load())
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) void load() }}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-md border border-border bg-card p-1 shadow-modal"
        >
          <div className="flex items-center justify-between border-b border-border px-2 py-2">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted',
                    !n.read && 'bg-primary/5'
                  )}
                >
                  <span className="flex w-full items-center gap-1.5 font-medium">
                    {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    {n.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{n.body}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </span>
                </button>
              ))
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
