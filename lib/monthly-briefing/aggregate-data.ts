// lib/monthly-briefing/aggregate-data.ts
// Pulls the user's last-30-day signal across every connected source and
// distills it into the compact JSON snapshot we feed to the synthesis step.
//
// Cheap (no AI calls). Designed to be safe to call repeatedly — it always
// queries fresh data and returns a fully-populated AggregatedDataSnapshot.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AggregatedDataSnapshot, FileKind, PeriodWindow } from './types'

const SAMPLE_LIMIT = 8

interface AggregateParams {
  userId: string
  teamId: string
  period: PeriodWindow
  uploads?: Array<{ file_name: string; file_kind: FileKind; extracted_summary: string | null }>
  userNotes?: string | null
}

export async function aggregateMonthlyData(
  supabase: SupabaseClient,
  params: AggregateParams,
): Promise<AggregatedDataSnapshot> {
  const { userId, teamId, period, uploads = [], userNotes } = params
  const { start, end } = period

  // ── User profile ────────────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, full_name, job_title, company, email')
    .eq('id', userId)
    .single()

  const user = {
    display_name: profile?.display_name || profile?.full_name || null,
    job_title: profile?.job_title || null,
    company: profile?.company || null,
    email: profile?.email || '',
  }

  // ── Commitments (created or assigned) ───────────────────────────────
  const { data: commitments } = await supabase
    .from('commitments')
    .select('id, title, status, source, priority_score, due_date, completed_at, created_at, category')
    .eq('team_id', teamId)
    .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
    .gte('created_at', start)
    .lte('created_at', end)
    .order('priority_score', { ascending: false })
    .limit(500)

  const commitmentRows = commitments || []
  const completed = commitmentRows.filter(c => c.status === 'completed')
  const overdue = commitmentRows.filter(c => c.status === 'overdue')
  const completionRate = commitmentRows.length
    ? Math.round((completed.length / commitmentRows.length) * 100)
    : 0

  const overdueSamples = overdue.slice(0, SAMPLE_LIMIT).map(c => {
    const due = c.due_date ? new Date(c.due_date) : null
    const days = due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86_400_000)) : 0
    return { title: c.title || 'Untitled', due_date: c.due_date, days_overdue: days }
  })

  const completedSamples = completed.slice(0, SAMPLE_LIMIT).map(c => ({
    title: c.title || 'Untitled',
    completed_at: c.completed_at,
    source: c.source || 'manual',
  }))

  const topByPriority = commitmentRows.slice(0, SAMPLE_LIMIT).map(c => ({
    title: c.title || 'Untitled',
    status: c.status || 'pending',
    source: c.source || 'manual',
    priority_score: c.priority_score || 0,
    due_date: c.due_date,
  }))

  // ── Calendar events ─────────────────────────────────────────────────
  const { data: events } = await supabase
    .from('outlook_calendar_events')
    .select('subject, attendees, start_time, end_time')
    .eq('team_id', teamId)
    .gte('start_time', start)
    .lte('start_time', end)
    .order('start_time', { ascending: true })
    .limit(500)

  const eventRows = events || []
  let totalMinutes = 0
  const attendeeCounts = new Map<string, number>()
  const subjectWords = new Map<string, number>()

  for (const ev of eventRows) {
    if (ev.start_time && ev.end_time) {
      const mins = (new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) / 60_000
      if (mins > 0 && mins < 600) totalMinutes += mins
    }
    const attendees: Array<{ name?: string; email?: string }> = Array.isArray(ev.attendees) ? ev.attendees : []
    for (const a of attendees) {
      const label = a.name || a.email
      if (!label) continue
      attendeeCounts.set(label, (attendeeCounts.get(label) || 0) + 1)
    }
    if (ev.subject) {
      for (const w of ev.subject.split(/\W+/)) {
        const word = w.toLowerCase()
        if (word.length < 4) continue
        if (STOPWORDS.has(word)) continue
        subjectWords.set(word, (subjectWords.get(word) || 0) + 1)
      }
    }
  }

  const topAttendees = Array.from(attendeeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, meetings]) => ({ name, meetings }))

  const recurringThemes = Array.from(subjectWords.entries())
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)

  // ── Meeting transcripts (with AI summaries) ─────────────────────────
  const { data: transcripts } = await supabase
    .from('meeting_transcripts')
    .select('title, start_time, summary_json')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .gte('start_time', start)
    .lte('start_time', end)
    .not('summary_json', 'is', null)
    .order('start_time', { ascending: false })
    .limit(SAMPLE_LIMIT)

  const meetingsWithTranscripts = (transcripts || [])
    .map(t => {
      const s = (t.summary_json || {}) as any
      return {
        title: t.title || 'Meeting',
        start_time: t.start_time,
        summary: s.summary || '',
        decisions: Array.isArray(s.decisionsMade) ? s.decisionsMade.map((d: any) => d.decision).filter(Boolean) : [],
        open_questions: Array.isArray(s.openQuestions) ? s.openQuestions.map((q: any) => q.question).filter(Boolean) : [],
        sentiment: s.meetingSentiment || 'neutral',
      }
    })
    .filter(m => m.summary || m.decisions.length || m.open_questions.length)

  // ── Email signal ────────────────────────────────────────────────────
  const { data: missedEmails } = await supabase
    .from('missed_emails')
    .select('from_name, urgency, category, status, received_at')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .gte('received_at', start)
    .lte('received_at', end)
    .limit(500)

  const missedEmailRows = missedEmails || []
  const emailCategories: Record<string, number> = {}
  const correspondentCounts = new Map<string, number>()
  let urgentMissed = 0
  for (const m of missedEmailRows) {
    if (m.category) emailCategories[m.category] = (emailCategories[m.category] || 0) + 1
    if (m.urgency === 'urgent' || m.urgency === 'high') urgentMissed += 1
    if (m.from_name) correspondentCounts.set(m.from_name, (correspondentCounts.get(m.from_name) || 0) + 1)
  }
  const topCorrespondents = Array.from(correspondentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const { count: awaitingTotal } = await supabase
    .from('awaiting_replies')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .gte('sent_at', start)
    .lte('sent_at', end)

  // ── Slack chat signal ───────────────────────────────────────────────
  const { data: missedChats } = await supabase
    .from('missed_chats')
    .select('channel_name, urgency, status, created_at')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .gte('created_at', start)
    .lte('created_at', end)
    .limit(500)

  const chatRows = missedChats || []
  const channelSet = new Set<string>()
  let urgentChats = 0
  for (const c of chatRows) {
    if (c.channel_name) channelSet.add(c.channel_name)
    if (c.urgency === 'urgent' || c.urgency === 'high') urgentChats += 1
  }

  // ── Final snapshot ──────────────────────────────────────────────────
  return {
    period,
    user,
    commitments: {
      total_created: commitmentRows.length,
      total_completed: completed.length,
      total_overdue: overdue.length,
      completion_rate_pct: completionRate,
      top_by_priority: topByPriority,
      overdue_samples: overdueSamples,
      completed_samples: completedSamples,
    },
    calendar: {
      total_meetings: eventRows.length,
      total_meeting_hours: Math.round(totalMinutes / 6) / 10, // one decimal
      top_attendees: topAttendees,
      recurring_themes: recurringThemes,
    },
    meetings_with_transcripts: meetingsWithTranscripts,
    emails: {
      missed_total: missedEmailRows.length,
      missed_urgent: urgentMissed,
      awaiting_replies_total: awaitingTotal || 0,
      categories: emailCategories,
      top_correspondents: topCorrespondents,
    },
    chats: {
      missed_total: chatRows.length,
      missed_urgent: urgentChats,
      channels_active: Array.from(channelSet).slice(0, 20),
    },
    uploaded_context: uploads.map(u => ({
      file_name: u.file_name,
      file_kind: u.file_kind,
      summary: u.extracted_summary || '(extraction pending or unavailable)',
    })),
    user_notes: userNotes || null,
  }
}

// ── Period helpers ────────────────────────────────────────────────────
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Returns the [start, end] ISO timestamps for the calendar month containing `date`. */
export function monthlyPeriodFor(date: Date): PeriodWindow {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    label: `${MONTH_NAMES[month]} ${year}`,
  }
}

const STOPWORDS = new Set([
  'meeting', 'call', 'sync', 'standup', 'weekly', 'monthly', 'daily', 'review',
  'with', 'and', 'the', 'for', 'from', 'team', 'check', 'discussion', 'chat',
  'office', 'hours', 'updates', 'update', 'planning', 'session', 'kickoff',
])
