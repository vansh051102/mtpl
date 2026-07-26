'use client'

import { cn } from '@/lib/utils'

interface HeroHealthRingProps {
  score: number
  size?: number
}

function colorForScore(score: number): string {
  if (score >= 80) return '#30D158'
  if (score >= 50) return '#FF9F0A'
  return '#FF453A'
}

/** Apple-style circular progress ring — CSS transition on stroke-dashoffset, no animation library. */
export function HeroHealthRing({ score, size = 160 }: HeroHealthRingProps) {
  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-muted" strokeWidth={10} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorForScore(clamped)}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-[400ms] ease-spring"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('font-display text-4xl font-bold tabular-nums text-foreground')}>{Math.round(clamped)}%</span>
        <span className="text-xs text-muted-foreground">Business Health</span>
      </div>
    </div>
  )
}
