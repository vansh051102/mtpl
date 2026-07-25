'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Contact,
  LayoutDashboard,
  Settings,
  Trophy,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/providers/auth-provider'
import { dashboardRouteForRole } from '@/lib/dashboard-routes'
import { Skeleton } from '@/components/ui/skeleton'

const STORAGE_KEY = 'veck-sidebar-collapsed'

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  permissions: string[]
}

const NAV_ICONS = { LayoutDashboard, Users, Contact, BarChart2, Trophy, Settings } as const

export function Sidebar() {
  const pathname = usePathname()
  const { user, isLoading } = useAuth()
  const role = user?.role ?? 'admin'
  const overviewHref = dashboardRouteForRole(role)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const navItems: NavItem[] = [
    {
      href: overviewHref,
      label: 'Overview',
      icon: NAV_ICONS.LayoutDashboard,
      permissions: [],
    },
    { href: '/leads', label: 'Leads', icon: NAV_ICONS.Users, permissions: ['leads:read'] },
    { href: '/contacts', label: 'Contacts', icon: NAV_ICONS.Contact, permissions: ['contacts:read'] },
    {
      href: '/analytics',
      label: 'Analytics',
      icon: NAV_ICONS.BarChart2,
      permissions: ['analytics:read'],
    },
    { href: '/performance', label: 'Performance', icon: NAV_ICONS.Trophy, permissions: [] },
    {
      href: role === 'admin' ? '/admin' : '/settings',
      label: role === 'admin' ? 'Admin' : 'Settings',
      icon: NAV_ICONS.Settings,
      permissions: role === 'admin' ? [] : ['settings:edit'],
    },
  ]

  const visibleItems = navItems.filter((item) => {
    if (item.permissions.length === 0) return true
    if (isLoading || !user) return true
    if (user.permissions.includes('*')) return true
    return item.permissions.some((p) => user.permissions.includes(p))
  })

  const initial = user?.fullName?.[0]?.toUpperCase() ?? 'v'
  const displayName = user?.fullName ?? (isLoading ? undefined : 'Profile')

  return (
    <nav
      className={cn(
        'flex h-full flex-col border-r border-border bg-primary py-3 text-primary-foreground transition-[width] duration-200',
        collapsed ? 'w-[3.75rem]' : 'w-56'
      )}
    >
      <div className={cn('mb-4 flex items-center', collapsed ? 'mx-auto' : 'mx-3 gap-1')}>
        <Link
          href={overviewHref}
          className={cn(
            'flex min-w-0 items-center rounded-lg transition-colors hover:bg-primary-foreground/10',
            collapsed ? 'justify-center p-1.5' : 'flex-1 gap-2.5 px-2 py-1.5'
          )}
          title="veck"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-sm font-bold tracking-tight">
            v
          </span>
          {!collapsed && <span className="truncate text-lg font-semibold tracking-tight">veck</span>}
        </Link>

        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Collapse sidebar"
            title="Collapse"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-primary-foreground/25 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className={cn('flex flex-1 flex-col gap-0.5', collapsed ? 'px-1.5' : 'px-2')}>
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== '/' && pathname?.startsWith(href + '/')) ||
            (href.startsWith('/dashboards') && pathname?.startsWith('/dashboards')) ||
            (href === '/admin' && pathname?.startsWith('/admin'))
          return (
            <Link
              key={`${href}-${label}`}
              href={href}
              title={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-10 items-center rounded-lg text-sm font-medium transition-colors',
                collapsed ? 'justify-center px-0' : 'gap-3 px-2.5',
                active
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground'
              )}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </div>

      <div className={cn('mt-auto flex flex-col gap-1', collapsed ? 'px-1.5' : 'px-2')}>
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Expand sidebar"
            title="Expand"
            className="mx-auto flex h-8 w-8 items-center justify-center rounded border border-primary-foreground/25 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}

        <Link
          href="/profile"
          title={displayName}
          className={cn(
            'flex items-center rounded-lg transition-colors hover:bg-primary-foreground/10',
            collapsed ? 'justify-center p-1.5' : 'gap-3 px-2.5 py-2'
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
            {initial}
          </span>
          {!collapsed && (
            isLoading ? (
              <Skeleton className="h-4 w-24 rounded-sm" />
            ) : (
              <span className="min-w-0 truncate text-sm font-medium">{displayName}</span>
            )
          )}
        </Link>
      </div>
    </nav>
  )
}
