interface EmptyStateProps {
  message: string
}

/** Positive empty state — CLAUDE.md: healthy/empty is a signal, not blank space. */
export function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="text-2xl" aria-hidden="true">
        🎉
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
