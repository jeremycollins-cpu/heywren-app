'use client'

import Link from 'next/link'
import type { Commitment } from '@/lib/stores/dashboard-store'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

interface NudgeCardProps {
  commitment: Commitment
  onDone: (id: string) => void
  onSnooze: (id: string) => void
  onDismiss: (id: string) => void
}

export function NudgeCard({ commitment: c, onDone, onSnooze, onDismiss }: NudgeCardProps) {
  const age = daysSince(c.created_at)
  const urgency = age > 7 ? 'URGENT' : age > 5 ? 'GENTLE' : 'DIGEST'
  const score = Math.max(100 - age * 5, 30)
  const borderColor = urgency === 'URGENT' ? 'border-l-red-500' : urgency === 'GENTLE' ? 'border-l-indigo-500' : 'border-l-gray-400'
  const badgeColor = urgency === 'URGENT' ? 'bg-red-100 text-red-700' : urgency === 'GENTLE' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700 dark:text-gray-300'
  const sourceBadge = c.source === 'slack' ? 'SLACK' : c.source === 'outlook' || c.source === 'email' ? 'OUTLOOK' : 'MANUAL'

  return (
    <article className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark border-l-4 ${borderColor} rounded-brand p-5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${badgeColor}`}>{urgency}</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">Score: {score}</span>
        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">{sourceBadge}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{age} days open</span>
      </div>
      <div className="font-bold text-gray-900 dark:text-white mb-1">{c.title}</div>
      {c.description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{c.description}</p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => onDone(c.id)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">Done</button>
        <button onClick={() => onSnooze(c.id)} className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 transition-colors">Snooze</button>
        <button onClick={() => onDismiss(c.id)} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">Dismiss</button>
        <Link
          href="/commitments"
          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          View Trace
        </Link>
      </div>
    </article>
  )
}
