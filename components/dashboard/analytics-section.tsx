'use client'

import type { Commitment } from '@/lib/stores/dashboard-store'

interface AnalyticsSectionProps {
  commitments: Commitment[]
}

function getWeekLabel(weeksAgo: number): string {
  const date = new Date()
  date.setDate(date.getDate() - weeksAgo * 7)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getWeeklyData(commitments: Commitment[]): { label: string; created: number; completed: number }[] {
  const weeks: { label: string; created: number; completed: number }[] = []
  const now = Date.now()

  for (let i = 3; i >= 0; i--) {
    const weekStart = now - (i + 1) * 7 * 86400000
    const weekEnd = now - i * 7 * 86400000
    const label = getWeekLabel(i)
    const created = commitments.filter(c => {
      const t = new Date(c.created_at).getTime()
      return t >= weekStart && t < weekEnd
    }).length
    const completed = commitments.filter(c => {
      const t = new Date(c.updated_at).getTime()
      return c.status === 'completed' && t >= weekStart && t < weekEnd
    }).length
    weeks.push({ label, created, completed })
  }
  return weeks
}

function getSourceBreakdown(commitments: Commitment[]): { source: string; count: number; color: string }[] {
  const counts: Record<string, number> = {}
  commitments.forEach(c => {
    const src = c.source || 'manual'
    counts[src] = (counts[src] || 0) + 1
  })
  const colorMap: Record<string, string> = {
    slack: '#7c3aed',
    outlook: '#3b82f6',
    email: '#3b82f6',
    meeting: '#f97316',
    calendar: '#f97316',
    manual: '#6b7280',
  }
  return Object.entries(counts)
    .map(([source, count]) => ({ source, count, color: colorMap[source] || '#6b7280' }))
    .sort((a, b) => b.count - a.count)
}

function MiniBarChart({ data }: { data: { label: string; created: number; completed: number }[] }) {
  const maxVal = Math.max(...data.flatMap(d => [d.created, d.completed]), 1)
  const barWidth = 20
  const gap = 6
  const groupWidth = barWidth * 2 + gap
  const chartWidth = data.length * groupWidth + (data.length - 1) * 16
  const chartHeight = 80

  return (
    <div className="overflow-x-auto">
      <svg width={chartWidth + 40} height={chartHeight + 30} className="mx-auto">
        {data.map((d, i) => {
          const x = i * (groupWidth + 16) + 20
          const createdH = (d.created / maxVal) * chartHeight
          const completedH = (d.completed / maxVal) * chartHeight
          return (
            <g key={i}>
              {/* Created bar */}
              <rect
                x={x}
                y={chartHeight - createdH}
                width={barWidth}
                height={createdH}
                rx={3}
                className="fill-indigo-400 dark:fill-indigo-500"
              />
              {d.created > 0 && (
                <text x={x + barWidth / 2} y={chartHeight - createdH - 4} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400 text-[10px]">
                  {d.created}
                </text>
              )}
              {/* Completed bar */}
              <rect
                x={x + barWidth + gap}
                y={chartHeight - completedH}
                width={barWidth}
                height={completedH}
                rx={3}
                className="fill-green-400 dark:fill-green-500"
              />
              {d.completed > 0 && (
                <text x={x + barWidth + gap + barWidth / 2} y={chartHeight - completedH - 4} textAnchor="middle" className="fill-gray-500 dark:fill-gray-400 text-[10px]">
                  {d.completed}
                </text>
              )}
              {/* Week label */}
              <text x={x + groupWidth / 2} y={chartHeight + 16} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500 text-[10px]">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function AnalyticsSection({ commitments }: AnalyticsSectionProps) {
  const weeklyData = getWeeklyData(commitments)
  const sources = getSourceBreakdown(commitments)
  const totalCommitments = commitments.length
  const completionRate = totalCommitments > 0
    ? Math.round((commitments.filter(c => c.status === 'completed').length / totalCommitments) * 100)
    : 0

  if (totalCommitments < 3) return null

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-brand p-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Analytics</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Weekly trend */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Weekly Trend</h3>
          <MiniBarChart data={weeklyData} />
          <div className="flex items-center gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400 dark:bg-indigo-500" /> New
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-400 dark:bg-green-500" /> Completed
            </div>
          </div>
        </div>

        {/* Source breakdown */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Sources</h3>
          <div className="space-y-2.5">
            {sources.map(s => {
              const pct = totalCommitments > 0 ? Math.round((s.count / totalCommitments) * 100) : 0
              return (
                <div key={s.source}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300 font-medium capitalize">
                      {s.source === 'email' ? 'Outlook' : s.source}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 text-xs">{s.count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: s.color }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Completion rate</span>
              <span className={`font-bold ${completionRate >= 60 ? 'text-green-600' : completionRate >= 30 ? 'text-yellow-600' : 'text-red-600'}`}>
                {completionRate}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
