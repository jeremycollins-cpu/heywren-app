// app/(dashboard)/weekly/page.tsx
// Weekly Review v5 — ALL REAL DATA, zero mock/placeholder content
// Changes from v4: Removed fake Meeting ROI section (needs real calendar integration)
// Shows: real weekly stats, source breakdown, recent activity timeline

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import toast from 'react-hot-toast'

interface Commitment {
  id: string
  title: string
  status: string
  source: string | null
  created_at: string
  updated_at: string
}

interface CalendarEvent {
  id: string
  subject: string | null
  start_time: string
  end_time: string
  organizer_name: string | null
  commitments_found: number
  processed: boolean
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function isThisWeek(dateStr: string): boolean {
  return daysSince(dateStr) <= 7
}

export default function WeeklyPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
  const [integrationCount, setIntegrationCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()

        // ── SECURITY: Get user's team_id first ──
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) {
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        const teamId = profile?.current_team_id
        if (!teamId) {
          setLoading(false)
          return
        }

        const { data, error: commitmentsError } = await supabase
          .from('commitments')
          .select('*')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })

        if (commitmentsError) throw commitmentsError

        const { data: intData, error: intError } = await supabase
          .from('integrations')
          .select('provider')
          .eq('team_id', teamId)

        if (intError) throw intError

        const sevenDaysAgo = new Date()
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
        const { data: calData, error: calError } = await supabase
          .from('outlook_calendar_events')
          .select('id, subject, start_time, end_time, organizer_name, commitments_found, processed')
          .eq('team_id', teamId)
          .gte('start_time', sevenDaysAgo.toISOString())
          .eq('is_cancelled', false)
          .order('start_time', { ascending: false })

        if (calError) throw calError

        if (data) setCommitments(data)
        if (calData) setCalendarEvents(calData)
        if (intData) setIntegrationCount(intData.length)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load weekly review'
        setError(message)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded"></div>
        </div>
      </div>
    )
  }

  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const thisWeekNew = commitments.filter(c => isThisWeek(c.created_at))
  const completedThisWeek = commitments.filter(c => c.status === 'completed' && isThisWeek(c.updated_at))
  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0

  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length
  const manualCount = commitments.filter(c => !c.source || c.source === 'manual').length

  // Week-over-week comparison (simple: compare this week vs prior week)
  const lastWeekNew = commitments.filter(c => {
    const d = daysSince(c.created_at)
    return d > 7 && d <= 14
  })
  const weekOverWeekChange = lastWeekNew.length > 0
    ? Math.round(((thisWeekNew.length - lastWeekNew.length) / lastWeekNew.length) * 100)
    : null

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Weekly Review</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Your personal pulse check — what got done, what moved forward, where to focus next</p>
        <p className="text-gray-400 text-xs mt-0.5">{weekLabel}</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            icon: '⚡',
            label: 'New This Week',
            value: thisWeekNew.length,
            color: thisWeekNew.length > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-400',
            sub: weekOverWeekChange !== null
              ? `${weekOverWeekChange >= 0 ? '+' : ''}${weekOverWeekChange}% vs last week`
              : null,
            subColor: weekOverWeekChange !== null
              ? weekOverWeekChange > 20 ? 'text-yellow-600' : weekOverWeekChange < -20 ? 'text-green-600' : 'text-gray-400'
              : 'text-gray-400'
          },
          {
            icon: '✅',
            label: 'Completed',
            value: completedThisWeek.length,
            color: completedThisWeek.length > 0 ? 'text-green-600' : 'text-gray-400',
            sub: null,
            subColor: 'text-gray-400'
          },
          {
            icon: '⏰',
            label: 'Still Open',
            value: open.length,
            color: open.length > 20 ? 'text-yellow-600' : 'text-gray-900 dark:text-white',
            sub: null,
            subColor: 'text-gray-400'
          },
          {
            icon: '📈',
            label: 'Follow-through',
            value: `${followThrough}%`,
            color: followThrough >= 50 ? 'text-green-600' : followThrough > 0 ? 'text-yellow-600' : 'text-gray-400',
            sub: null,
            subColor: 'text-gray-400'
          },
        ].map(({ icon, label, value, color, sub, subColor }) => (
          <div key={label} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <span>{icon}</span> {label}
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            {sub && <div className={`text-xs mt-1 ${subColor}`}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Meeting ROI */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Meeting ROI</h2>
          {calendarEvents.length > 0 && (
            <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded text-xs font-medium">
              {calendarEvents.length} meeting{calendarEvents.length !== 1 ? 's' : ''} this week
            </span>
          )}
        </div>
        {calendarEvents.length === 0 ? (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
              Connect your calendar to see which meetings generate the most action items and follow-through.
            </p>
            <Link
              href="/integrations"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 rounded-lg text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Connect Calendar
            </Link>
          </>
        ) : (
          <div className="space-y-3">
            {calendarEvents.map(event => {
              const calendarCommitments = commitments.filter(
                c => c.source === 'calendar' && new Date(c.created_at) >= new Date(event.start_time) && new Date(c.created_at) <= new Date(new Date(event.end_time).getTime() + 24 * 60 * 60 * 1000)
              )
              const score = event.commitments_found > 0 ? event.commitments_found : calendarCommitments.length
              return (
                <div key={event.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {event.subject || 'Untitled Meeting'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {' at '}
                      {new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {event.organizer_name && (
                        <span className="ml-2 text-gray-400">by {event.organizer_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <div className="text-right">
                      <div className={`text-lg font-bold ${score > 0 ? 'text-indigo-600' : 'text-gray-300'}`}>
                        {score}
                      </div>
                      <div className="text-xs text-gray-400">
                        {score === 1 ? 'commitment' : 'commitments'}
                      </div>
                    </div>
                    <div className={`w-2 h-8 rounded-full ${
                      score >= 3 ? 'bg-green-400' : score >= 1 ? 'bg-indigo-400' : 'bg-gray-200'
                    }`} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sources */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Sources</h2>
        {commitments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">No commitments tracked yet. Source breakdown will appear as data flows in.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg p-3">
              <div className="w-8 h-8 bg-purple-500 rounded flex items-center justify-center text-white text-sm font-bold">#</div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Slack</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{slackCount}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3">
              <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-white text-sm font-bold">@</div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Outlook</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{outlookCount}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <div className="w-8 h-8 bg-gray-400 rounded flex items-center justify-center text-white text-sm font-bold">+</div>
              <div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Manual</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{manualCount}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Recent Activity</h2>
        {commitments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm">Activity will appear here as commitments are tracked.</p>
        ) : (
          <div className="space-y-3">
            {commitments.slice(0, 8).map(c => (
              <div key={c.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${c.status === 'completed' ? 'bg-green-500' : 'bg-indigo-500'}`} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{c.title}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  {c.source && (
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      c.source === 'slack' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400' :
                      c.source === 'outlook' || c.source === 'email' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                    }`}>
                      {c.source}
                    </span>
                  )}
                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
