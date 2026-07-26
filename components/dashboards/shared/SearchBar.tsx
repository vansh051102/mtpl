'use client'

import { Search } from 'lucide-react'
import { COMMAND_PALETTE_OPEN_EVENT } from './CommandPalette'

/** Visual entry point into the CommandPalette — the palette itself listens
 * for both Cmd+K and this click-dispatched event, so there's one source of truth. */
export function SearchBar() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT))}
      className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
    >
      <Search className="h-4 w-4" />
      Search
      <kbd className="ml-2 rounded border border-border bg-card px-1.5 py-0.5 text-xs">⌘K</kbd>
    </button>
  )
}
