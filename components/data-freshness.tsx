'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface DataFreshnessProps {
  lastUpdated: Date | null
  onRefresh: () => void
  refreshing?: boolean
}

/** Apple-style status pill: 🟢 Live · Updated 12s ago, with a manual refresh. */
export function DataFreshness({ lastUpdated, onRefresh, refreshing }: DataFreshnessProps) {
  const [, forceTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const secondsAgo = lastUpdated ? Math.max(0, Math.round((Date.now() - lastUpdated.getTime()) / 1000)) : null
  const stale = secondsAgo !== null && secondsAgo > 120

  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${stale ? 'bg-apple-orange' : 'bg-apple-green'}`} />
      {secondsAgo === null ? 'Loading…' : stale ? `Stale · ${secondsAgo}s ago` : `Live · Updated ${secondsAgo}s ago`}
      <button
        type="button"
        onClick={onRefresh}
        aria-label="Refresh"
        className={`ml-1 rounded-md p-0.5 hover:bg-muted disabled:cursor-not-allowed ${refreshing ? 'opacity-40' : ''}`}
        disabled={refreshing}
      >
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  )
}
