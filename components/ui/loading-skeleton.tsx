'use client'

interface LoadingSkeletonProps {
  variant?: 'dashboard' | 'list' | 'card'
}

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className ?? ''}`}
    />
  )
}

function StatCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3">
      <Bone className="h-3 w-20" />
      <Bone className="h-8 w-16" />
      <Bone className="h-2 w-full rounded-full" />
    </div>
  )
}

function NudgeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Bone className="h-4 w-48" />
        <Bone className="h-5 w-16 rounded-full" />
      </div>
      <Bone className="h-3 w-full" />
      <Bone className="h-3 w-3/4" />
      <div className="flex items-center gap-2 pt-1">
        <Bone className="h-8 w-20 rounded-lg" />
        <Bone className="h-8 w-20 rounded-lg" />
        <Bone className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  )
}

export function LoadingSkeleton({ variant = 'dashboard' }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return <StatCardSkeleton />
  }

  if (variant === 'list') {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading content">
        {Array.from({ length: 4 }).map((_, i) => (
          <NudgeCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div
      className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-4 sm:space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {/* Page header */}
      <div className="space-y-2">
        <Bone className="h-7 w-56" />
        <Bone className="h-4 w-72" />
      </div>

      {/* Hero stats section */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Bone className="h-16 w-16 rounded-full" />
          <div className="space-y-2 flex-1">
            <Bone className="h-5 w-32" />
            <Bone className="h-3 w-48" />
          </div>
        </div>
        <Bone className="h-3 w-full rounded-full" />
      </div>

      {/* Today's focus section */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-3">
        <Bone className="h-5 w-36" />
        <Bone className="h-3 w-full" />
        <Bone className="h-3 w-5/6" />
      </div>

      {/* Stat cards row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Stat cards row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Forecast / Mentions placeholders */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-3">
        <Bone className="h-5 w-28" />
        <Bone className="h-32 w-full rounded-lg" />
      </div>

      {/* Nudge cards */}
      <div className="space-y-4">
        <Bone className="h-5 w-44" />
        <NudgeCardSkeleton />
        <NudgeCardSkeleton />
        <NudgeCardSkeleton />
      </div>
    </div>
  )
}
