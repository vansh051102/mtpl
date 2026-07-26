import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const CHECKLIST_ITEMS = [
  { question: 'Any SLA-breached leads open right now?', href: '/sla-dashboard' },
  { question: 'Any leads stuck in Quote Sent for more than 4 days?', href: '/leads?stage=Quote+Sent' },
  { question: "Who's online right now?", href: '/employees/command-center' },
  { question: 'Any open purchase requests still pending with a supplier?', href: '/dashboards/purchase' },
]

/** Static Sales/Lead-Gen/Purchase/presence questions the owner checks each morning — each links to the existing report or list that already answers it. */
export function OwnerMorningChecklist() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Morning Checklist</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {CHECKLIST_ITEMS.map((item) => (
          <Link
            key={item.question}
            href={item.href}
            className="rounded-md border border-border p-2 text-sm text-foreground hover:bg-muted"
          >
            {item.question}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
