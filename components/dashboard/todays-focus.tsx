'use client'

import Link from 'next/link'
import type { Commitment } from '@/lib/stores/dashboard-store'
import { ArrowRight, AlertTriangle, Clock, CheckCircle2, Zap } from 'lucide-react'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

interface TodaysFocusProps {
  commitments: Commitment[]
  integrationCount: number
  onMarkDone: (id: string) => void
}

export function TodaysFocus({ commitments, integrationCount, onMarkDone }: TodaysFocusProps) {
  const open = commitments.filter(c => c.status === 'open')
  const overdue = commitments.filter(c => c.status === 'overdue')
  const atRisk = open.filter(c => daysSince(c.created_at) > 5)

  // Priority items: overdue first, then at-risk, then newest open
  const priorityItems = [
    ...overdue.slice(0, 2),
    ...atRisk.filter(c => !overdue.includes(c)).slice(0, 2),
    ...open.filter(c => !overdue.includes(c) && !atRisk.includes(c)).slice(0, 1),
  ].slice(0, 3)

  if (commitments.length === 0) return null

  const getActionLabel = (c: Commitment) => {
    const age = daysSince(c.created_at)
    if (c.status === 'overdue') return { text: 'Overdue', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-900/20' }
    if (age > 7) return { text: 'At risk', icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-900/20' }
    if (age > 3) return { text: 'Stalling', icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' }
    return { text: 'New', icon: Zap, color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-50 dark:bg-indigo-900/20' }
  }

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Today&apos;s Focus</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {priorityItems.length > 0 ? 'Your most urgent items right now' : 'You\'re in great shape'}
          </p>
        </div>
        <Link
          href="/commitments"
          className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {priorityItems.length === 0 ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">All clear!</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">No urgent items need your attention</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {priorityItems.map(c => {
            const action = getActionLabel(c)
            const Icon = action.icon
            return (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/5 transition group">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold ${action.bgColor} ${action.color} flex-shrink-0`}>
                  <Icon className="w-3 h-3" />
                  {action.text}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {daysSince(c.created_at)}d ago
                    {c.source && <> &middot; {c.source === 'slack' ? 'Slack' : c.source === 'outlook' || c.source === 'email' ? 'Email' : c.source}</>}
                  </p>
                </div>
                <button
                  onClick={() => onMarkDone(c.id)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-md hover:bg-green-100 dark:hover:bg-green-900/50 transition flex-shrink-0"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Done
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
