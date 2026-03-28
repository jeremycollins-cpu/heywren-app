// app/(dashboard)/briefings/page.tsx
// Pre-Meeting Briefings — real data from outlook_calendar_events, commitments, outlook_messages

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import { Briefcase, Clock, Users, FileText, ChevronDown, ChevronUp, Heart, MessageSquare, Copy, CheckCircle2 } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'

// ── Types ──

interface Attendee {
  name: string
  email: string
  response?: string
}

interface AttendeeWithHealth extends Attendee {
  interactions: number
  daysSinceContact: number
  healthScore: number
}

interface MatchedCommitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  created_at: string
}

interface Briefing {
  id: string
  subject: string
  startTime: string
  endTime: string
  organizer: { name: string; email: string }
  attendees: AttendeeWithHealth[]
  location: string | null
  bodyPreview: string | null
  matchedCommitments: MatchedCommitment[]
  talkingPoints: string[]
}

// ── Health score helpers (same logic as relationships page) ──

function daysSince(dateStr: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)))
}

function calculateHealthScore(interactions: number, daysSinceLastContact: number): number {
  let score = 50
  if (interactions >= 20) score += 25
  else if (interactions >= 10) score += 15
  else if (interactions >= 5) score += 8
  if (daysSinceLastContact > 14) score -= 30
  else if (daysSinceLastContact > 7) score -= 15
  else if (daysSinceLastContact > 3) score -= 5
  else score += 10
  return Math.max(10, Math.min(99, score))
}

function getScoreColor(score: number): { ring: string; text: string } {
  if (score >= 75) return { ring: '#22c55e', text: 'text-green-600' }
  if (score >= 50) return { ring: '#6366f1', text: 'text-indigo-600' }
  if (score >= 35) return { ring: '#f59e0b', text: 'text-yellow-600' }
  return { ring: '#ef4444', text: 'text-red-600' }
}

// ── Format helpers ──

function formatMeetingTime(startTime: string, endTime: string): string {
  const start = new Date(startTime)
  const end = new Date(endTime)
  const now = new Date()
  const diffMs = start.getTime() - now.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

  const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  let relativeStr = ''
  if (diffMs < 0) {
    relativeStr = 'In progress'
  } else if (diffHours < 1) {
    relativeStr = `In ${diffMins} min`
  } else if (diffHours < 24) {
    relativeStr = `In ${diffHours}h ${diffMins > 0 ? `${diffMins}m` : ''}`
  } else {
    const days = Math.ceil(diffHours / 24)
    relativeStr = `In ${days} day${days !== 1 ? 's' : ''}`
  }

  return `${dateStr} · ${timeStr} – ${endStr} · ${relativeStr}`
}

// ── Generate talking points from commitment data ──

function generateTalkingPoints(
  commitments: MatchedCommitment[],
  attendees: AttendeeWithHealth[],
  subject: string
): string[] {
  const points: string[] = []

  const overdueOrOld = commitments.filter(c => {
    const age = daysSince(c.created_at)
    return age > 7
  })
  if (overdueOrOld.length > 0) {
    points.push(`Follow up on ${overdueOrOld.length} commitment${overdueOrOld.length > 1 ? 's' : ''} open for 7+ days: ${overdueOrOld.slice(0, 2).map(c => `"${c.title}"`).join(', ')}`)
  }

  const weakRelationships = attendees.filter(a => a.healthScore < 50 && a.interactions >= 3)
  if (weakRelationships.length > 0) {
    points.push(`Reconnect with ${weakRelationships.map(a => a.name).join(', ')} — relationship health is low`)
  }

  const recentCommitments = commitments.filter(c => daysSince(c.created_at) <= 3)
  if (recentCommitments.length > 0) {
    points.push(`Review ${recentCommitments.length} recently created commitment${recentCommitments.length > 1 ? 's' : ''}: ${recentCommitments.slice(0, 2).map(c => `"${c.title}"`).join(', ')}`)
  }

  if (commitments.length > 0 && points.length === 0) {
    points.push(`${commitments.length} open commitment${commitments.length > 1 ? 's' : ''} relevant to this meeting — review status before discussion`)
  }

  if (points.length === 0) {
    points.push('No outstanding commitments found for attendees — opportunity to align on new action items')
  }

  return points
}

// ── Matching logic: find commitments related to attendees or meeting subject ──
// STRICT matching: only match by full attendee names (5+ chars), external company
// domains, or stakeholder metadata. NO short word matching from subject.

function findMatchingCommitments(
  commitments: MatchedCommitment[],
  attendees: Attendee[],
  subject: string
): MatchedCommitment[] {
  // Build strict match criteria
  const attendeeFullNames = attendees
    .map(a => (a.name || '').toLowerCase().trim())
    .filter(n => n.length >= 5)

  // Extract external company domains (not the user's own company)
  const externalCompanies = [...new Set(
    attendees
      .map(a => {
        const domain = (a.email || '').split('@')[1]?.split('.')[0]
        return domain?.toLowerCase()
      })
      .filter((d): d is string =>
        !!d && d.length >= 4 &&
        !['gmail', 'yahoo', 'outlook', 'hotmail', 'live', 'icloud', 'routeware'].includes(d)
      )
  )]

  // Only use very specific subject terms (8+ chars, not common meeting words)
  const STOP_WORDS = new Set([
    'meeting', 'discussion', 'review', 'update', 'weekly', 'monthly', 'daily',
    'leadership', 'check', 'about', 'their', 'these', 'other', 'which', 'where',
    'there', 'would', 'could', 'should', 'every', 'after', 'before', 'status',
    'planning', 'alignment', 'overview', 'progress', 'session', 'standup',
    'touchpoint', 'touchbase', 'recurring', 'follow', 'general',
  ])
  const subjectTerms = (subject || '').toLowerCase()
    .split(/[\s:+\-–—,/()]+/)
    .filter(w => w.length >= 8 && !STOP_WORDS.has(w))

  return commitments.filter(c => {
    const titleLower = (c.title || '').toLowerCase()
    const descLower = (c.description || '').toLowerCase()
    const combined = titleLower + ' ' + descLower

    // 1. Match by attendee FULL name (most reliable)
    for (const fullName of attendeeFullNames) {
      if (combined.includes(fullName)) return true
    }

    // 2. Match by external company name from attendee domain
    for (const company of externalCompanies) {
      if (combined.includes(company)) return true
    }

    // 3. Match by very specific subject terms only (8+ chars)
    for (const term of subjectTerms) {
      if (combined.includes(term)) return true
    }

    return false
  })
}

// ── Parse attendees from JSONB ──

function parseAttendees(raw: any): Attendee[] {
  if (!raw) return []
  if (!Array.isArray(raw)) return []
  return raw
    .map((a: any) => ({
      name: a.name || a.emailAddress?.name || a.email?.split('@')[0] || 'Unknown',
      email: (a.email || a.emailAddress?.address || '').toLowerCase(),
      response: a.response || a.status?.response || 'none',
    }))
    .filter((a: Attendee) => a.email)
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedBriefing, setExpandedBriefing] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [checkedItems, setCheckedItems] = useState<Record<string, Set<string>>>({})

  const toggleCheckItem = (briefingId: string, item: string) => {
    setCheckedItems(prev => {
      const set = new Set(prev[briefingId] || [])
      if (set.has(item)) set.delete(item)
      else set.add(item)
      return { ...prev, [briefingId]: set }
    })
  }

  const copyTalkingPoints = (briefing: Briefing) => {
    const text = [
      `Meeting Prep: ${briefing.subject}`,
      `${formatMeetingTime(briefing.startTime, briefing.endTime)}`,
      ``,
      `Talking Points:`,
      ...briefing.talkingPoints.map((p, i) => `${i + 1}. ${p}`),
      ``,
      briefing.matchedCommitments.length > 0 ? `Open Commitments (${briefing.matchedCommitments.length}):` : '',
      ...briefing.matchedCommitments.map(c => `- ${c.title} (${daysSince(c.created_at)}d old)`),
    ].filter(l => l !== '').join('\n')
    navigator.clipboard.writeText(text)
    setCopiedId(briefing.id)
    toast.success('Briefing copied to clipboard')
    setTimeout(() => setCopiedId(null), 2000)
  }

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

      // ── Fetch upcoming calendar events (next 7 days) ──
      const now = new Date().toISOString()
      const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

      const userEmail = userData.user.email?.toLowerCase() || ''
      const { data: rawEvents } = await supabase
        .from('outlook_calendar_events')
        .select('id, subject, organizer_name, organizer_email, attendees, start_time, end_time, location, body_preview, is_cancelled')
        .eq('team_id', teamId)
        .eq('is_cancelled', false)
        .gte('start_time', now)
        .lte('start_time', sevenDaysLater)
        .order('start_time', { ascending: true })

      // Filter to only events involving this user (organizer or attendee)
      const events = (rawEvents || []).filter((evt: any) => {
        if ((evt.organizer_email || '').toLowerCase() === userEmail) return true
        const attendeesStr = JSON.stringify(evt.attendees || '').toLowerCase()
        return attendeesStr.includes(userEmail)
      })

      if (!events || events.length === 0) {
        // Check if Outlook is connected via server-side API (bypasses RLS)
        const intRes = await fetch('/api/integrations/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : { integrations: [] })
        const hasOutlook = intRes.integrations?.some((i: any) => i.provider === 'outlook')

        if (hasOutlook) {
          setError('no_calendar_data')
        }

        setLoading(false)
        return
      }

      // ── Fetch open commitments for this user ──
      const { data: commitments } = await supabase
        .from('commitments')
        .select('id, title, description, status, source, created_at')
        .eq('team_id', teamId)
        .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
        .eq('status', 'open')

      const openCommitments: MatchedCommitment[] = (commitments || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        status: c.status,
        source: c.source,
        created_at: c.created_at,
      }))

      // ── Fetch messages for health score calculation — scoped to user's emails ──
      const { data: emailData } = await supabase
        .from('outlook_messages')
        .select('from_email, from_name, received_at, to_recipients')
        .eq('team_id', teamId)
        .or(`from_email.eq.${userEmail},to_recipients.ilike.%${userEmail}%`)
        .order('received_at', { ascending: false })
        .limit(1000)

      // Build contact interaction map — only count emails involving this user
      const contactMap: Record<string, { count: number; lastDate: string }> = {}
      if (emailData) {
        const filteredEmails = emailData.filter((msg: any) => {
          const from = (msg.from_email || '').toLowerCase()
          const recipients = JSON.stringify(msg.to_recipients || '').toLowerCase()
          return from === userEmail || recipients.includes(userEmail)
        })
        filteredEmails.forEach((msg: any) => {
          const email = (msg.from_email || '').toLowerCase()
          if (!email || email.includes('noreply') || email.includes('no-reply') || email.includes('notification') || email.includes('mailer-daemon')) return
          if (!contactMap[email]) {
            contactMap[email] = { count: 0, lastDate: msg.received_at }
          }
          contactMap[email].count++
          if (msg.received_at > contactMap[email].lastDate) {
            contactMap[email].lastDate = msg.received_at
          }
        })
      }

      // ── Build briefing objects ──
      const briefingList: Briefing[] = events.map((event: any) => {
        const rawAttendees = parseAttendees(event.attendees)

        // Enrich attendees with health scores
        const enrichedAttendees: AttendeeWithHealth[] = rawAttendees.map(a => {
          const contact = contactMap[a.email]
          const interactions = contact?.count || 0
          const dsc = contact ? daysSince(contact.lastDate) : 999
          return {
            ...a,
            interactions,
            daysSinceContact: dsc,
            healthScore: calculateHealthScore(interactions, dsc),
          }
        })

        // Find relevant commitments
        const matched = findMatchingCommitments(openCommitments, rawAttendees, event.subject || '')

        // Generate talking points
        const talkingPoints = generateTalkingPoints(matched, enrichedAttendees, event.subject || '')

        return {
          id: event.id,
          subject: event.subject || 'Untitled Meeting',
          startTime: event.start_time,
          endTime: event.end_time,
          organizer: {
            name: event.organizer_name || 'Unknown',
            email: (event.organizer_email || '').toLowerCase(),
          },
          attendees: enrichedAttendees,
          location: event.location,
          bodyPreview: event.body_preview,
          matchedCommitments: matched,
          talkingPoints,
        }
      })

      setBriefings(briefingList)
      setLoading(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load briefings'
        setError(message)
        toast.error(message)
        setLoading(false)
      }
    }

    load()
  }, [])

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <UpgradeGate featureKey="briefings">
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Pre-Meeting Briefings</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Context cards for every upcoming meeting — open commitments, relationships, and talking points
        </p>
      </div>

      {error && error !== 'no_calendar_data' && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3 text-sm text-red-800 dark:text-red-400">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Upcoming Briefings */}
      <div className="space-y-3">
        {briefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/40 flex items-center justify-center mb-4">
              <Briefcase className="w-8 h-8 text-indigo-400" />
            </div>
            {error === 'no_calendar_data' ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No calendar events synced yet</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
                  Your Outlook account is connected, but calendar events haven&apos;t been synced yet.
                  Go to the Sync page and run an Outlook sync to pull in your upcoming meetings.
                </p>
                <a href="/sync" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Sync Calendar
                </a>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No upcoming meetings</h3>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
                  Connect your calendar to Slack or Outlook to automatically generate context briefings for your upcoming meetings. HeyWren will surface relevant commitments and relationships for each meeting.
                </p>
                <a href="/integrations" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Connect Calendar
                </a>
              </>
            )}
          </div>
        ) : (
          briefings.map((briefing) => {
            const isExpanded = expandedBriefing === briefing.id
            const avgHealth = briefing.attendees.length > 0
              ? Math.round(briefing.attendees.reduce((s, a) => s + a.healthScore, 0) / briefing.attendees.length)
              : 0

            return (
              <div
                key={briefing.id}
                className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden hover:shadow-md transition"
              >
                {/* Card header — always visible */}
                <div
                  className="p-6 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedBriefing(isExpanded ? null : briefing.id) } }}
                  onClick={() => setExpandedBriefing(isExpanded ? null : briefing.id)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Briefcase aria-hidden="true" className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                        <h3 className="font-semibold text-gray-900 dark:text-white">{briefing.subject}</h3>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 flex-wrap">
                        <div className="flex items-center gap-1">
                          <Clock aria-hidden="true" className="w-4 h-4" />
                          {formatMeetingTime(briefing.startTime, briefing.endTime)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Users aria-hidden="true" className="w-4 h-4" />
                          {briefing.attendees.length} attendee{briefing.attendees.length !== 1 ? 's' : ''}
                        </div>
                        {briefing.location && (
                          <div className="text-gray-400 text-xs truncate max-w-[200px]">
                            {briefing.location}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 ml-4">
                      <div className="text-right">
                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Open Commitments</div>
                        <div className={`text-2xl font-bold ${briefing.matchedCommitments.length > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                          {briefing.matchedCommitments.length}
                        </div>
                      </div>
                      {isExpanded
                        ? <ChevronUp aria-hidden="true" className="w-5 h-5 text-gray-400" />
                        : <ChevronDown aria-hidden="true" className="w-5 h-5 text-gray-400" />
                      }
                    </div>
                  </div>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-5 border-t border-gray-100 dark:border-gray-700 pt-5">

                    {/* Attendees with health scores */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <Users aria-hidden="true" className="w-4 h-4 text-indigo-600" />
                        Attendees
                        {avgHealth > 0 && (
                          <span className="text-xs text-gray-400 font-normal ml-1">Avg. health: {avgHealth}</span>
                        )}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {briefing.attendees.map((attendee) => {
                          const scoreColor = getScoreColor(attendee.healthScore)
                          const initials = attendee.name
                            .split(' ')
                            .map(n => n[0])
                            .join('')
                            .toUpperCase()
                            .slice(0, 2)
                          const colors = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500']
                          const bgColor = colors[attendee.name.charCodeAt(0) % colors.length]
                          const lastContactText = attendee.daysSinceContact === 0 ? 'Today'
                            : attendee.daysSinceContact === 1 ? '1 day ago'
                            : attendee.daysSinceContact > 900 ? 'No data'
                            : `${attendee.daysSinceContact}d ago`

                          return (
                            <div key={attendee.email} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                              <div className={`w-8 h-8 ${bgColor} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                                {initials}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                                  {attendee.name}
                                  {attendee.response === 'accepted' && <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Accepted" />}
                                  {attendee.response === 'tentative' && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 text-amber-600 text-[9px] font-bold flex-shrink-0" title="Tentative">?</span>}
                                  {attendee.response === 'declined' && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-red-100 text-red-500 text-[9px] font-bold flex-shrink-0" title="Declined">&times;</span>}
                                  {(!attendee.response || attendee.response === 'none') && <span className="inline-block w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" title="No response" />}
                                </div>
                                <div className="text-xs text-gray-400 truncate">{attendee.email}</div>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="text-right">
                                  <div className="text-xs text-gray-400">{lastContactText}</div>
                                  <div className="text-xs text-gray-400">{attendee.interactions} msg{attendee.interactions !== 1 ? 's' : ''}</div>
                                </div>
                                {/* Mini health ring */}
                                <div className="relative w-9 h-9">
                                  <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                                    <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="2.5" />
                                    <circle
                                      cx="18" cy="18" r="15" fill="none"
                                      stroke={scoreColor.ring}
                                      strokeWidth="2.5"
                                      strokeDasharray={`${(attendee.healthScore / 100) * 94.2} 94.2`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className={`text-[10px] font-bold ${scoreColor.text}`}>{attendee.healthScore}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {briefing.attendees.length === 0 && (
                        <p className="text-sm text-gray-400">No attendee data available</p>
                      )}
                    </div>

                    {/* Relevant open commitments */}
                    {briefing.matchedCommitments.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                          <FileText aria-hidden="true" className="w-4 h-4 text-indigo-600" />
                          Relevant Open Commitments
                        </h4>
                        <div className="space-y-2">
                          {briefing.matchedCommitments.map(c => {
                            const age = daysSince(c.created_at)
                            const isOld = age > 7
                            return (
                              <div key={c.id} className={`flex items-start gap-3 p-3 rounded-lg border ${isOld ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800'}`}>
                                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${isOld ? 'bg-red-500' : 'bg-yellow-500'}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white">{c.title}</div>
                                  {c.description && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{c.description}</div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-gray-400">{age} day{age !== 1 ? 's' : ''} old</span>
                                    {c.source && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                        c.source === 'slack' ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400' :
                                        c.source === 'outlook' || c.source === 'email' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' :
                                        'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                                      }`}>
                                        {c.source}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Prep Checklist */}
                    {(() => {
                      const checklistItems = [
                        ...(briefing.matchedCommitments.length > 0 ? [`Review ${briefing.matchedCommitments.length} open commitment${briefing.matchedCommitments.length > 1 ? 's' : ''}`] : []),
                        ...(briefing.attendees.filter(a => a.healthScore < 50).length > 0 ? [`Reconnect with ${briefing.attendees.filter(a => a.healthScore < 50).map(a => a.name).slice(0, 2).join(', ')}`] : []),
                        'Review talking points below',
                        'Prepare follow-up action items',
                      ]
                      const checked = checkedItems[briefing.id] || new Set()
                      const allDone = checklistItems.every(item => checked.has(item))

                      return (
                        <div className={`rounded-lg p-4 border ${allDone ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/50' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50'}`}>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                            <CheckCircle2 className={`w-4 h-4 ${allDone ? 'text-green-600' : 'text-amber-500'}`} />
                            Pre-Meeting Checklist
                            <span className="text-xs font-normal text-gray-400 ml-auto">{checked.size}/{checklistItems.length}</span>
                          </h4>
                          <div className="space-y-2">
                            {checklistItems.map((item, i) => (
                              <label key={i} className="flex items-center gap-2.5 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={checked.has(item)}
                                  onChange={() => toggleCheckItem(briefing.id, item)}
                                  className="w-4 h-4 rounded cursor-pointer"
                                />
                                <span className={`text-sm ${checked.has(item) ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                  {item}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })()}

                    {/* Talking points */}
                    <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-300 flex items-center gap-2">
                          <MessageSquare aria-hidden="true" className="w-4 h-4" />
                          Suggested Talking Points
                        </h4>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyTalkingPoints(briefing) }}
                          className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {copiedId === briefing.id ? (
                            <><CheckCircle2 className="w-3 h-3" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copy briefing</>
                          )}
                        </button>
                      </div>
                      <div className="space-y-2">
                        {briefing.talkingPoints.map((point, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-indigo-800 dark:text-indigo-300">
                            <span className="w-2 h-2 bg-indigo-500 rounded-full mt-1.5 flex-shrink-0" />
                            {point}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Briefing Features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6">
          <h3 className="font-semibold text-indigo-900 dark:text-indigo-300 mb-2">What&apos;s Included</h3>
          <ul className="text-sm text-indigo-800 dark:text-indigo-300 space-y-2">
            <li className="flex items-center gap-2"><Heart aria-hidden="true" className="w-3.5 h-3.5" /> Relationship health scores per attendee</li>
            <li className="flex items-center gap-2"><FileText aria-hidden="true" className="w-3.5 h-3.5" /> Open commitments relevant to this meeting</li>
            <li className="flex items-center gap-2"><MessageSquare aria-hidden="true" className="w-3.5 h-3.5" /> Suggested talking points</li>
            <li className="flex items-center gap-2"><Users aria-hidden="true" className="w-3.5 h-3.5" /> Recent interaction history</li>
          </ul>
        </div>
        <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-6">
          <h3 className="font-semibold text-purple-900 dark:text-purple-300 mb-2">How It Works</h3>
          <ul className="text-sm text-purple-800 dark:text-purple-300 space-y-2">
            <li className="flex items-center gap-2"><Clock aria-hidden="true" className="w-3.5 h-3.5" /> Scans your next 7 days of meetings</li>
            <li className="flex items-center gap-2"><Briefcase aria-hidden="true" className="w-3.5 h-3.5" /> Matches attendees to open commitments</li>
            <li className="flex items-center gap-2"><Heart aria-hidden="true" className="w-3.5 h-3.5" /> Calculates health from email patterns</li>
            <li className="flex items-center gap-2"><FileText aria-hidden="true" className="w-3.5 h-3.5" /> Generates context you can act on</li>
          </ul>
        </div>
      </div>
    </div>
    </UpgradeGate>
  )
}
