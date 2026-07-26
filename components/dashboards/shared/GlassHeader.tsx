'use client'

interface GlassHeaderProps {
  title: string
  shiftPhase: string
  right?: React.ReactNode
}

/** Floating glass top bar — backdrop-blur, theme-aware translucency. */
export function GlassHeader({ title, shiftPhase, right }: GlassHeaderProps) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between rounded-3xl border border-border bg-white/75 px-5 py-3 backdrop-blur-md dark:bg-black/40">
      <div>
        <h1 className="font-display text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground">{shiftPhase}</p>
      </div>
      {right}
    </div>
  )
}
