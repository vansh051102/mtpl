'use client'

import { Skeleton } from '@/components/ui/skeleton'

export function FormFieldSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5" style={{ animationDelay: `${i * 80}ms` }}>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  )
}

export function DrawerHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-6 w-6 rounded" />
    </div>
  )
}

export function ModalContentSkeleton({ variant = 'minimal' }: { variant?: 'minimal' | 'list' }) {
  if (variant === 'list') {
    return (
      <div className="flex flex-col gap-4 p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2" style={{ animationDelay: `${i * 80}ms` }}>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-10 w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
