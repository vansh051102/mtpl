import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { PrioritySeverity } from '@/lib/executive-priorities'

const SEVERITY_CLASSES: Record<PrioritySeverity, string> = {
  RED: 'bg-apple-red/10 text-apple-red',
  ORANGE: 'bg-apple-orange/10 text-apple-orange',
  GREEN: 'bg-apple-green/10 text-apple-green',
}

const SEVERITY_DOT: Record<PrioritySeverity, string> = {
  RED: 'bg-apple-red',
  ORANGE: 'bg-apple-orange',
  GREEN: 'bg-apple-green',
}

interface AlertPillProps {
  severity: PrioritySeverity
  message: string
  actionUrl: string
}

export function AlertPill({ severity, message, actionUrl }: AlertPillProps) {
  return (
    <Link
      href={actionUrl}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-transform duration-300 ease-spring hover:scale-[1.02]',
        SEVERITY_CLASSES[severity]
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[severity])} />
      {message}
    </Link>
  )
}
