'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, LogOut, Menu, Search, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell } from '@/components/notification-bell'
import { supabaseBrowser } from '@/lib/supabase-browser'
import { useCurrentUser } from '@/lib/use-current-user'

function pageTitle(pathname: string | null): string {
  if (!pathname) return 'veck'
  if (pathname.startsWith('/leads')) return 'Leads'
  if (pathname.startsWith('/analytics')) return 'Analytics'
  if (pathname.startsWith('/performance')) return 'Performance'
  if (pathname.startsWith('/profile')) return 'Profile'
  if (pathname.startsWith('/dashboards') || pathname === '/dashboard') return 'Overview'
  if (pathname.startsWith('/settings')) return 'Settings'
  return 'veck'
}

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const me = useCurrentUser()
  const title = pageTitle(pathname)
  const initial = me?.fullName?.[0]?.toUpperCase() ?? '?'

  async function handleSignOut() {
    // signOut() can reject rather than resolve — still navigate to login
    // either way, since that's the point of clicking sign out.
    try {
      await supabaseBrowser.auth.signOut()
    } finally {
      router.push('/auth/login')
      router.refresh()
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <label className="relative hidden sm:block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search"
            className="h-9 w-48 rounded-full border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring lg:w-64"
          />
        </label>

        <NotificationBell />

        <ThemeToggle />

        {me && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Open profile menu"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initial}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-[12rem] rounded-md border border-border bg-card p-1 shadow-modal"
              >
                <div className="border-b border-border px-2 py-2">
                  <p className="text-sm font-medium">{me.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{me.email}</p>
                </div>
                <DropdownMenu.Item asChild>
                  <Link
                    href="/profile"
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted"
                  >
                    <User className="h-4 w-4" />
                    My Profile
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={handleSignOut}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-muted"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </header>
  )
}
