import { PageSkeleton } from '@/components/ui/skeleton-variants'

export default function Loading() {
  return (
    <div aria-live="polite" aria-busy="true" aria-label="Loading content">
      <PageSkeleton />
      <span className="sr-only">Loading...</span>
    </div>
  )
}
