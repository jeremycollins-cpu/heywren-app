// app/(dashboard)/briefings/page.tsx
// Pre-Meeting Briefings — real data from outlook_calendar_events, commitments, outlook_messages

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { Briefcase, Clock, Users, FileText, ChevronDown, ChevronUp, Heart, MessageSquare } from 'lucide-react'

// ── Types ──

interface Attendee {
  name: string
  email: string
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

function findMatchingCommitments(
  commitments: MatchedCommitment[],
  attendees: Attendee[],
  subject: string
): MatchedCommitment[] {
  const subjectWords = (subject || '').toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const attendeeNames = attendees.map(a => (a.name || '').toLowerCase()).filter(Boolean)
  const attendeeEmails = attendees.map(a => (a.email || '').toLowerCase()).filter(Boolean)

  return commitments.filter(c => {
    const titleLower = (c.title || '').toLowerCase()
    const descLower = (c.description || '').toLowerCase()
    const combined = titleLower + ' ' + descLower

    // Check if any attendee name appears in the commitment
    for (const name of attendeeNames) {
      if (name.length > 2 && combined.includes(name)) return true
      // Also check first/last name parts
      const parts = name.split(/\s+/)
      for (const part of parts) {
        if (part.length > 3 && combined.includes(part)) return true
      }
    }

    // Check if any attendee email prefix appears
    for (const email of attendeeEmails) {
      const prefix = email.split('@')[0]
      if (prefix.length > 3 && combined.includes(prefix)) return true
    }

    // Check if subject words match
    for (const word of subjectWords) {
      if (combined.includes(word)) return true
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
    }))
    .filter((a: Attendee) => a.email)
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedBriefing, setExpandedBriefing] = useState<string | null>(null)

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

      const { data: events } = await supabase
        .from('outlook_calendar_events')
        .select('id, subject, organizer_name, organizer_email, attendees, start_time, end_time, location, body_preview, is_cancelled')
        .eq('team_id', teamId)
        .eq('is_cancelled', false)
        .gte('start_time', now)
        .lte('start_time', sevenDaysLater)
        .order('start_time', { ascending: true })

      if (!events || events.length === 0) {
        setLoading(false)
        return
      }

      // ── Fetch open commitments for the team ──
      const { data: commitments } = await supabase
        .from('commitments')
        .select('id, title, description, status, source, created_at')
        .eq('team_id', teamId)
        .eq('status', 'open')

      const openCommitments: MatchedCommitment[] = (commitments || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        status: c.status,
        source: c.source,
        created_at: c.created_at,
      }))

      // ── Fetch messages for health score calculation ──
      const { data: emailData } = await supabase
        .from('outlook_messages')
        .select('from_email, from_name, received_at')
        .eq('team_id', teamId)
        .order('received_at', { ascending: false })
        .limit(1000)

      // Build contact interaction map
      const contactMap: Record<string, { count: number; lastDate: string }> = {}
      if (emailData) {
        emailData.forEach((msg: any) => {
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
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-100 rounded w-1/2"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Pre-Meeting Briefings</h1>
        <p className="text-gray-600 mt-1">
          Context cards for every upcoming meeting — open commitments, relationships, and talking points
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-sm text-red-800">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Upcoming Briefings */}
      <div className="space-y-3">
        {briefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <Briefcase className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No upcoming meetings</h3>
            <p className="text-gray-500 max-w-md mb-6">
              Connect your calendar to Slack or Outlook to automatically generate context briefings for your upcoming meetings. HeyWren will surface relevant commitments and relationships for each meeting.
            </p>
            <a href="/integrations" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Connect Calendar
            </a>
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
                className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition"
              >
                {/* Card header — always visible */}
                <div
                  className="p-6 cursor-pointer"
                  onClick={() => setExpandedBriefing(isExpanded ? null : briefing.id)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Briefcase className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                        <h3 className="font-semibold text-gray-900">{briefing.subject}</h3>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatMeetingTime(briefing.startTime, briefing.endTime)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
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
                        <div className="text-xs text-gray-600 mb-1">Open Commitments</div>
                        <div className={`text-2xl font-bold ${briefing.matchedCommitments.length > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                          {briefing.matchedCommitments.length}
                        </div>
                      </div>
                      {isExpanded
                        ? <ChevronUp className="w-5 h-5 text-gray-400" />
                        : <ChevronDown className="w-5 h-5 text-gray-400" />
                      }
                    </div>
                  </div>
                </div>

                {/* Expanded view */}
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-5 border-t border-gray-100 pt-5">

                    {/* Attendees with health scores */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-600" />
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
                            <div key={attendee.email} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                              <div className={`w-8 h-8 ${bgColor} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                                {initials}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">{attendee.name}</div>
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
                        <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-indigo-600" />
                          Relevant Open Commitments
                        </h4>
                        <div className="space-y-2">
                          {briefing.matchedCommitments.map(c => {
                            const age = daysSince(c.created_at)
                            const isOld = age > 7
                            return (
                              <div key={c.id} className={`flex items-start gap-3 p-3 rounded-lg border ${isOld ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
                                <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${isOld ? 'bg-red-500' : 'bg-yellow-500'}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900">{c.title}</div>
                                  {c.description && (
                                    <div className="text-xs text-gray-500 mt-0.5 truncate">{c.description}</div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-gray-400">{age} day{age !== 1 ? 's' : ''} old</span>
                                    {c.source && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                        c.source === 'slack' ? 'bg-purple-100 text-purple-700' :
                                        c.source === 'outlook' || c.source === 'email' ? 'bg-blue-100 text-blue-700' :
                                        'bg-gray-100 text-gray-600'
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

                    {/* Talking points */}
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Suggested Talking Points
                      </h4>
                      <div className="space-y-2">
                        {briefing.talkingPoints.map((point, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-indigo-800">
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
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
          <h3 className="font-semibold text-indigo-900 mb-2">What's Included</h3>
          <ul className="text-sm text-indigo-800 space-y-2">
            <li className="flex items-center gap-2"><Heart className="w-3.5 h-3.5" /> Relationship health scores per attendee</li>
            <li className="flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Open commitments relevant to this meeting</li>
            <li className="flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5" /> Suggested talking points</li>
            <li className="flex items-center gap-2"><Users className="w-3.5 h-3.5" /> Recent interaction history</li>
          </ul>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
          <h3 className="font-semibold text-purple-900 mb-2">How It Works</h3>
          <ul className="text-sm text-purple-800 space-y-2">
            <li className="flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> Scans your next 7 days of meetings</li>
            <li className="flex items-center gap-2"><Briefcase className="w-3.5 h-3.5" /> Matches attendees to open commitments</li>
            <li className="flex items-center gap-2"><Heart className="w-3.5 h-3.5" /> Calculates health from email patterns</li>
            <li className="flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Generates context you can act on</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
