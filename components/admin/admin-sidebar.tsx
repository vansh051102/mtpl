'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const SECTIONS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: 'Basic setup',
    items: [
      { href: 'company-details', label: 'Company Details' },
      { href: 'integrations', label: 'Integrations' },
      { href: 'roles-hierarchy', label: 'Roles & Hierarchy' },
      { href: 'members', label: 'Members' },
    ],
  },
  {
    title: 'Billing',
    items: [{ href: 'subscriptions', label: 'Subscriptions' }],
  },
  {
    title: 'Communication',
    items: [
      { href: 'templates', label: 'Template Library' },
      { href: 'template-insights', label: 'Template Insights' },
      { href: 'stage-mapping', label: 'Stage Mapping' },
    ],
  },
  {
    title: 'Lead management',
    items: [
      { href: 'module-access', label: 'Module Access' },
      { href: 'lead-workflow', label: 'Lead Workflow' },
      { href: 'lead-settings', label: 'Lead Settings' },
      { href: 'tally-bridge', label: 'Tally Bridge' },
      { href: 'engine-platform', label: 'Engine Platform' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { href: 'sla-dashboard', label: 'SLA Dashboard' },
      { href: 'anomaly-queue', label: 'Anomaly Queue' },
    ],
  },
]

export function AdminSidebar({ orgId }: { orgId: string }) {
  const pathname = usePathname()
  const base = `/admin/workspace/${orgId}`

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-4 py-4">
        <Link href="/admin" className="text-lg font-semibold tracking-tight text-primary">
          veck
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">Workspace admin</p>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            <p className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const href = `${base}/${item.href}`
                const active = pathname === href || pathname?.startsWith(href + '/')
                return (
                  <li key={item.href}>
                    <Link
                      href={href}
                      className={cn(
                        'block rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-foreground/80 hover:bg-muted'
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
