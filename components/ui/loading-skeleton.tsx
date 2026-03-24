'use client'

interface LoadingSkeletonProps {
  variant?: 'dashboard' | 'list' | 'card'
}

export function LoadingSkeleton({ variant = 'dashboard' }: LoadingSkeletonProps) {
  if (variant === 'list') {
    return (
      <div className="p-8" role="status" aria-busy="true" aria-label="Loading content">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-brand" />
          ))}
        </div>
      </div>
    )
  }

  if (variant === 'card') {
    return (
      <div className="p-8" role="status" aria-busy="true" aria-label="Loading content">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
          <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded-brand" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8" role="status" aria-busy="true" aria-label="Loading dashboard">
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded-brand" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-brand" />
          ))}
        </div>
      </div>
    </div>
  )
}
