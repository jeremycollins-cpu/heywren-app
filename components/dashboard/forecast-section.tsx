'use client'

import type { Commitment } from '@/lib/stores/dashboard-store'
import { isActive, isCompleted, isExcluded } from '@/lib/commitments/status'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

interface ForecastSectionProps {
  commitments: Commitment[]
}

export function ForecastSection({ commitments }: ForecastSectionProps) {
  const open = commitments.filter(c => isActive(c.status))
  const completed = commitments.filter(c => isCompleted(c.status))
  const relevant = commitments.filter(c => !isExcluded(c.status))
  const completionRate = relevant.length > 0 ? completed.length / relevant.length : 0
  const daysToClean = completionRate > 0 ? Math.ceil(open.length / (completionRate * 7)) * 7 : null
  const staleItems = open.filter(c => daysSince(c.created_at) > 7).length

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-brand p-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Wren&apos;s Forecast</h2>
      <div className="space-y-3">
        {commitments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">Forecasts will appear once Wren has tracked enough commitments to identify patterns.</p>
        ) : (
          <>
            {daysToClean ? (
              <div className="flex items-start gap-3">
                <span className="text-green-500 mt-0.5" aria-hidden="true">✓</span>
                <span className="text-gray-700 dark:text-gray-300">
                  At current pace, backlog clears by{' '}
                  <span className="font-bold">
                    {new Date(Date.now() + daysToClean * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  </span>
                </span>
              </div>
            ) : open.length > 0 ? (
              <div className="flex items-start gap-3">
                <span className="text-yellow-500 mt-0.5" aria-hidden="true">⚠</span>
                <span className="text-gray-700 dark:text-gray-300">
                  No completions yet — start closing items to build your forecast
                </span>
              </div>
            ) : null}

            {staleItems > 0 && (
              <div className="flex items-start gap-3">
                <span className="text-red-500 mt-0.5" aria-hidden="true">⚠</span>
                <span className="text-gray-700 dark:text-gray-300">
                  <span className="text-red-600 font-semibold">{staleItems} item{staleItems > 1 ? 's' : ''} stale for 7+ days</span>{' '}
                  — review and close or update
                </span>
              </div>
            )}

            {open.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="text-gray-400 dark:text-gray-500 mt-0.5" aria-hidden="true">📋</span>
                <span className="text-gray-700 dark:text-gray-300">
                  {open.length} open commitment{open.length !== 1 ? 's' : ''} need follow-through this week
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
