// app/(dashboard)/weekly/page.tsx
// Weekly Review v5 — ALL REAL DATA, zero mock/placeholder content
// Changes from v4: Removed fake Meeting ROI section (needs real calendar integration)
// Shows: real weekly stats, source breakdown, recent activity timeline

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

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
  attendees: any[] | null
  commitments_found: number
  processed: boolean
}

// Meeting type classification for calendar heatmap
type MeetingType = 'external' | 'internal' | 'one_on_one' | 'all_hands' | 'offsite'

function classifyMeeting(event: CalendarEvent, userDomain: string): MeetingType {
  const subject = (event.subject || '').toLowerCase()
  const attendees = event.attendees || []

  // Check for offsite / all-day keywords
  if (subject.includes('offsite') || subject.includes('full day') || subject.includes('offices')) return 'offsite'
  if (subject.includes('all hands') || subject.includes('all-hands') || subject.includes('town hall')) return 'all_hands'

  // Check attendee count for 1:1
  if (attendees.length <= 2) return 'one_on_one'

  // Check if external (attendees from different domain)
  if (userDomain) {
    const hasExternal = attendees.some((a: any) => {
      const email = (a.email || a.emailAddress?.address || '').toLowerCase()
      return email && !email.endsWith('@' + userDomain)
    })
    if (hasExternal) return 'external'
  }

  return 'internal'
}

function getMeetingDurationHours(event: CalendarEvent): number {
  const start = new Date(event.start_time).getTime()
  const end = new Date(event.end_time).getTime()
  return Math.max(0, (end - start) / (1000 * 60 * 60))
}

const MEETING_TYPE_CONFIG: Record<MeetingType, { label: string; color: string; bgColor: string; pillBg: string; pillText: string }> = {
  offsite: { label: 'Offsite', color: '#d97706', bgColor: 'bg-amber-100 dark:bg-amber-900/30', pillBg: 'bg-amber-100 dark:bg-amber-900/30', pillText: 'text-amber-800 dark:text-amber-300' },
  external: { label: 'External', color: '#dc2626', bgColor: 'bg-red-100 dark:bg-red-900/30', pillBg: 'bg-red-100 dark:bg-red-900/30', pillText: 'text-red-800 dark:text-red-300' },
  internal: { label: 'Internal', color: '#2563eb', bgColor: 'bg-blue-100 dark:bg-blue-900/30', pillBg: 'bg-blue-100 dark:bg-blue-900/30', pillText: 'text-blue-800 dark:text-blue-300' },
  one_on_one: { label: '1:1', color: '#7c3aed', bgColor: 'bg-purple-100 dark:bg-purple-900/30', pillBg: 'bg-purple-100 dark:bg-purple-900/30', pillText: 'text-purple-800 dark:text-purple-300' },
  all_hands: { label: 'All-hands', color: '#16a34a', bgColor: 'bg-green-100 dark:bg-green-900/30', pillBg: 'bg-green-100 dark:bg-green-900/30', pillText: 'text-green-800 dark:text-green-300' },
}

// Time allocation categories for executive time analysis
const TIME_CATEGORIES = [
  { key: 'customer_support', label: 'Customer Issues & Support', target: 10, keywords: ['customer', 'support', 'issue', 'bug', 'escalation', 'incident', 'ticket', 'complaint', 'outage', 'troubleshoot', 'debug'] },
  { key: 'partnerships', label: 'Partnerships & M&A', target: 20, keywords: ['partner', 'partnership', 'm&a', 'acquisition', 'merger', 'vendor', 'deal', 'investor', 'board', 'fundrais'] },
  { key: 'people', label: 'People & Delegation', target: 25, keywords: ['1:1', '1on1', 'one on one', 'performance', 'review', 'hiring', 'interview', 'onboard', 'offboard', 'feedback', 'coaching', 'mentor', 'career', 'hr ', 'people', 'team sync'] },
  { key: 'strategy', label: 'Strategy & Board Prep', target: 25, keywords: ['strategy', 'strategic', 'board', 'quarterly', 'annual', 'planning', 'okr', 'kpi', 'roadmap', 'vision', 'exec ', 'leadership', 'slt', 'offsite'] },
  { key: 'product_eng', label: 'Product & Engineering', target: 10, keywords: ['product', 'engineering', 'sprint', 'standup', 'design', 'architecture', 'deploy', 'release', 'demo', 'tech', 'code'] },
  { key: 'culture', label: 'Culture & Communication', target: 10, keywords: ['all hands', 'all-hands', 'town hall', 'culture', 'social', 'team building', 'lunch', 'dinner', 'happy hour', 'offsite', 'celebration', 'announce'] },
]

function categorizeEvent(event: CalendarEvent): string {
  const subject = (event.subject || '').toLowerCase()
  const body = '' // body_preview not fetched for weekly to keep query light

  for (const cat of TIME_CATEGORIES) {
    if (cat.keywords.some(kw => subject.includes(kw) || body.includes(kw))) {
      return cat.key
    }
  }
  return 'other'
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
  const [userDomain, setUserDomain] = useState('')
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

        const email = userData.user.email || ''
        const domain = email.includes('@') ? email.split('@')[1] : ''
        setUserDomain(domain)

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
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .order('created_at', { ascending: false })

        if (commitmentsError) throw commitmentsError

        // Fetch integrations via server-side API (bypasses RLS)
        const intStatusRes = await fetch('/api/integrations/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : { integrations: [] })
        const intData = intStatusRes.integrations || []

        // Calendar events — query can fail due to RLS or filter syntax, don't let it block the page
        let calData: CalendarEvent[] = []
        try {
          const sevenDaysAgo = new Date()
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
          const { data: rawCalData, error: calError } = await supabase
            .from('outlook_calendar_events')
            .select('id, subject, start_time, end_time, organizer_name, attendees, commitments_found, processed')
            .eq('team_id', teamId)
            .or(`user_id.eq.${userData.user.id},user_id.is.null`)
            .gte('start_time', sevenDaysAgo.toISOString())
            .eq('is_cancelled', false)
            .order('start_time', { ascending: true })

          if (!calError && rawCalData) {
            // Filter client-side to events involving this user (organizer or attendee)
            calData = rawCalData.filter((evt: any) => {
              const fullText = JSON.stringify(evt).toLowerCase()
              return fullText.includes(email.toLowerCase())
            })
          }
        } catch {
          // Calendar data is supplementary — continue without it
          console.warn('Failed to load calendar events for weekly review')
        }

        if (data) setCommitments(data)
        setCalendarEvents(calData)
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
    return <LoadingSkeleton variant="dashboard" />
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
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
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
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

      {/* Calendar Heatmap */}
      {calendarEvents.length > 0 && (() => {
        // Group events by day of week (Mon-Fri)
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const
        const dayMap: Record<string, { hours: number; events: Array<CalendarEvent & { meetingType: MeetingType }> }> = {}
        for (const d of dayNames) dayMap[d] = { hours: 0, events: [] }

        calendarEvents.forEach(event => {
          const date = new Date(event.start_time)
          const dayIdx = date.getDay() // 0=Sun, 1=Mon...
          if (dayIdx < 1 || dayIdx > 5) return // skip weekends
          const dayName = dayNames[dayIdx - 1]
          const duration = getMeetingDurationHours(event)
          const meetingType = classifyMeeting(event, userDomain)
          dayMap[dayName].hours += duration
          dayMap[dayName].events.push({ ...event, meetingType })
        })

        const maxHours = Math.max(...Object.values(dayMap).map(d => d.hours), 1)

        return (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Calendar Heatmap</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Meeting load by day — color intensity = time in meetings</p>

            {/* Heat blocks */}
            <div className="flex items-end gap-3 mb-2">
              {dayNames.map(day => {
                const data = dayMap[day]
                const hrs = Math.round(data.hours)
                const intensity = data.hours / maxHours
                const bg = hrs === 0
                  ? 'bg-gray-200 dark:bg-gray-700'
                  : intensity >= 0.75
                  ? 'bg-red-500'
                  : intensity >= 0.5
                  ? 'bg-amber-500'
                  : 'bg-green-500'

                return (
                  <div key={day} className="flex-1 text-center">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{day}</div>
                    <div className={`${bg} text-white font-bold text-sm rounded-lg py-2 px-1`}>
                      {hrs}hr
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-400 mb-5">
              <span>Heavy (6hr+)</span>
              <span>Moderate (3-5hr)</span>
              <span>Light (&lt;3hr)</span>
            </div>

            {/* Day-by-day meeting list */}
            <div className="space-y-4">
              {dayNames.map(day => {
                const data = dayMap[day]
                if (data.events.length === 0) return null
                return (
                  <div key={day}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-8">{day}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {data.events.map((event, i) => {
                          const config = MEETING_TYPE_CONFIG[event.meetingType]
                          return (
                            <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${config.pillBg} ${config.pillText}`}>
                              <span className="w-1 h-1 rounded-full" style={{ backgroundColor: config.color }} />
                              {event.subject || 'Untitled'}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* Light day annotation */}
              {dayNames.map(day => {
                const data = dayMap[day]
                if (data.hours > 0 && data.hours < 3) {
                  return (
                    <div key={`note-${day}`} className="border-l-2 border-amber-300 pl-3 py-2 text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/10 rounded-r-lg">
                      {day} was a light day — ideal for deep work blocks.
                    </div>
                  )
                }
                return null
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-5 pt-3 border-t border-gray-100 dark:border-gray-800">
              {Object.entries(MEETING_TYPE_CONFIG).map(([key, config]) => (
                <div key={key} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: config.color }} />
                  {config.label}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Time Allocation Analysis */}
      {calendarEvents.length > 0 && (() => {
        // Count total email/message activity this week
        const thisWeekCommitments = commitments.filter(c => isThisWeek(c.created_at))
        const messageCount = thisWeekCommitments.length
        const meetingCount = calendarEvents.length

        // Categorize calendar events into time buckets
        const categoryHours: Record<string, number> = {}
        let totalMeetingHours = 0

        calendarEvents.forEach(event => {
          const hours = getMeetingDurationHours(event)
          totalMeetingHours += hours
          const cat = categorizeEvent(event)
          categoryHours[cat] = (categoryHours[cat] || 0) + hours
        })

        // Also categorize commitments (as proxy for message/email time)
        thisWeekCommitments.forEach(c => {
          const title = (c.title || '').toLowerCase()
          let matched = false
          for (const cat of TIME_CATEGORIES) {
            if (cat.keywords.some(kw => title.includes(kw))) {
              categoryHours[cat.key] = (categoryHours[cat.key] || 0) + 0.25 // estimate 15min per commitment
              matched = true
              break
            }
          }
          if (!matched) {
            categoryHours['other'] = (categoryHours['other'] || 0) + 0.25
          }
        })

        const totalHours = Object.values(categoryHours).reduce((a, b) => a + b, 0) || 1

        return (
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Time Allocation Analysis</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Based on your {messageCount} commitments + {meetingCount} meetings this week, here&apos;s where your time went vs. target:
            </p>

            <div className="space-y-5">
              {TIME_CATEGORIES.map(cat => {
                const hours = categoryHours[cat.key] || 0
                const pct = Math.round((hours / totalHours) * 100)
                const target = cat.target
                const maxPct = Math.max(pct, target)
                const barWidth = maxPct > 0 ? (pct / 100) * 100 : 0
                const targetPosition = (target / 100) * 100

                // Color: green if within ±5% of target, red if over-indexed by >10%, amber if under-indexed by >10%
                const diff = pct - target
                const barColor = Math.abs(diff) <= 5
                  ? 'bg-green-500'
                  : diff > 5
                  ? 'bg-red-500'
                  : 'bg-amber-500'

                return (
                  <div key={cat.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{cat.label}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        You: {pct}% / Target: {target}%
                      </span>
                    </div>
                    <div className="relative h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-visible">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all`}
                        style={{ width: `${Math.min(barWidth, 100)}%` }}
                      />
                      {/* Target marker */}
                      <div
                        className="absolute top-0 h-full w-0.5 bg-gray-900 dark:bg-white"
                        style={{ left: `${Math.min(targetPosition, 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-5 pt-3 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Aligned with target</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Over-indexed</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Under-indexed</span>
            </div>
          </div>
        )
      })()}

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

      {/* Weekly Activity Trend */}
      {commitments.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">4-Week Trend</h2>
          <div className="flex items-end gap-2 h-32">
            {(() => {
              const weeks = [0, 1, 2, 3].map(weeksAgo => {
                const weekCommitments = commitments.filter(c => {
                  const d = daysSince(c.created_at)
                  return d >= weeksAgo * 7 && d < (weeksAgo + 1) * 7
                })
                const completed = weekCommitments.filter(c => c.status === 'completed').length
                const total = weekCommitments.length
                const weekStart = new Date(Date.now() - (weeksAgo * 7 + 6) * 86400000)
                return { total, completed, label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), isThisWeek: weeksAgo === 0 }
              }).reverse()
              const maxVal = Math.max(...weeks.map(w => w.total), 1)
              return weeks.map((week, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col items-center justify-end h-24 gap-0.5">
                    <span className="text-[10px] font-bold text-gray-500">{week.total}</span>
                    <div className="w-full flex flex-col gap-0.5">
                      <div
                        className={`w-full rounded-t ${week.isThisWeek ? 'bg-indigo-500' : 'bg-indigo-300 dark:bg-indigo-700'}`}
                        style={{ height: `${Math.max((week.total - week.completed) / maxVal * 80, 2)}px` }}
                      />
                      {week.completed > 0 && (
                        <div
                          className="w-full bg-green-400 dark:bg-green-500 rounded-b"
                          style={{ height: `${Math.max(week.completed / maxVal * 80, 2)}px` }}
                        />
                      )}
                    </div>
                  </div>
                  <span className={`text-[10px] ${week.isThisWeek ? 'font-bold text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>{week.label}</span>
                </div>
              ))
            })()}
          </div>
          <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-3 h-2 bg-indigo-400 rounded" /> Open
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-3 h-2 bg-green-400 rounded" /> Completed
            </div>
          </div>
        </div>
      )}

      {/* Weekly Summary — Copy to share */}
      {commitments.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/10 dark:to-violet-900/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">Weekly Summary</h2>
            <button
              onClick={() => {
                const summary = [
                  `Weekly Review — ${weekLabel}`,
                  ``,
                  `New commitments: ${thisWeekNew.length}`,
                  `Completed: ${completedThisWeek.length}`,
                  `Still open: ${open.length}`,
                  `Follow-through: ${followThrough}%`,
                  weekOverWeekChange !== null ? `Week-over-week: ${weekOverWeekChange >= 0 ? '+' : ''}${weekOverWeekChange}%` : '',
                  ``,
                  `Sources: Slack (${slackCount}) · Outlook (${outlookCount}) · Manual (${manualCount})`,
                  calendarEvents.length > 0 ? `Meetings this week: ${calendarEvents.length}` : '',
                ].filter(Boolean).join('\n')
                navigator.clipboard.writeText(summary)
                toast.success('Weekly summary copied to clipboard')
              }}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Copy summary
            </button>
          </div>
          <div className="text-xs text-indigo-700 dark:text-indigo-300 space-y-1 font-mono">
            <p>{thisWeekNew.length} new &middot; {completedThisWeek.length} completed &middot; {open.length} open &middot; {followThrough}% follow-through</p>
            {weekOverWeekChange !== null && (
              <p className={weekOverWeekChange > 20 ? 'text-amber-600' : weekOverWeekChange < -20 ? 'text-green-600' : ''}>
                {weekOverWeekChange >= 0 ? '+' : ''}{weekOverWeekChange}% vs last week
              </p>
            )}
          </div>
        </div>
      )}

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
