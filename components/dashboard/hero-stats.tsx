'use client'

import type { Commitment } from '@/lib/stores/dashboard-store'

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function getStreakDays(commitments: Commitment[]): number {
  const activityDates = new Set<string>()
  commitments.forEach(c => {
    activityDates.add(new Date(c.created_at).toISOString().split('T')[0])
    activityDates.add(new Date(c.updated_at).toISOString().split('T')[0])
  })
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (activityDates.has(d.toISOString().split('T')[0])) {
      streak++
    } else if (i > 0) break
  }
  return streak
}

function getFollowThroughPercent(commitments: Commitment[]): number {
  if (commitments.length === 0) return 0
  return Math.round((commitments.filter(c => c.status === 'completed').length / commitments.length) * 100)
}

function get7DayTrend(commitments: Commitment[]): number[] {
  const trend: number[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const count = commitments.filter(c => {
      const created = new Date(c.created_at).toISOString().split('T')[0]
      const updated = new Date(c.updated_at).toISOString().split('T')[0]
      return created === key || updated === key
    }).length
    trend.push(Math.min(count / 5, 1))
  }
  return trend
}

function getLevel(xp: number): string {
  if (xp >= 2000) return 'Legend'
  if (xp >= 1500) return 'Expert'
  if (xp >= 1000) return 'Consistent'
  if (xp >= 500) return 'Building'
  if (xp >= 200) return 'Warming Up'
  return 'Getting Started'
}

interface HeroStatsProps {
  commitments: Commitment[]
}

export function HeroStats({ commitments }: HeroStatsProps) {
  const streak = getStreakDays(commitments)
  const followThrough = getFollowThroughPercent(commitments)
  const trend = get7DayTrend(commitments)
  const completed = commitments.filter(c => c.status === 'completed').length
  const xp = (commitments.length * 10) + (completed * 25)
  const level = getLevel(xp)

  return (
    <section
      className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-brand p-6"
      aria-label="Performance overview"
    >
      <div className="flex items-center gap-8 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">🔥</span>
          <div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white">{streak}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">day streak</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14">
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56" role="img" aria-label={`Follow-through rate: ${followThrough}%`}>
              <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="4" />
              <circle
                cx="28" cy="28" r="24" fill="none"
                stroke={followThrough >= 70 ? '#22c55e' : followThrough >= 40 ? '#f59e0b' : '#ef4444'}
                strokeWidth="4"
                strokeDasharray={`${(followThrough / 100) * 150.8} 150.8`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold">{followThrough}%</span>
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Follow-through</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{commitments.length} total commitments</div>
          </div>
        </div>

        <div className="flex items-center gap-3" aria-label={`7-day activity trend`}>
          <div className="flex items-end gap-0.5 h-8" aria-hidden="true">
            {trend.map((val, i) => (
              <div
                key={i}
                className="w-2 rounded-sm"
                style={{
                  height: `${Math.max(val * 100, 10)}%`,
                  backgroundColor: val > 0.5 ? '#6366f1' : val > 0 ? '#a5b4fc' : '#e5e7eb',
                }}
              />
            ))}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">7-day trend</div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-semibold">
            {level}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{xp.toLocaleString()} XP</span>
        </div>
      </div>
    </section>
  )
}
