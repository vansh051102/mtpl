import { AlertPill } from './AlertPill'
import { EmptyState } from './EmptyState'
import type { Priority } from '@/lib/executive-priorities'

export function PriorityList({ priorities }: { priorities: Priority[] }) {
  if (priorities.length === 0) {
    return <EmptyState message="No critical issues today. All departments are within SLA." />
  }
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {priorities.map((p, i) => (
        <AlertPill key={i} severity={p.severity} message={p.message} actionUrl={p.actionUrl} />
      ))}
    </div>
  )
}
