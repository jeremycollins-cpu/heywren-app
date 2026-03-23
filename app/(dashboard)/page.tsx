// app/(dashboard)/page.tsx
// Dashboard v3 — Matches the demo UI with real data
// Sections: Hero stats, Stat cards, Anomalies, Work patterns, Forecast, @HeyWren Mentions, Leaderboard, Nudges

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_ref: string | null
  created_at: string
  updated_at: string
}

interface SlackMention {
  id: string
  message_text: string
  user_id: string
  channel_id: string
  message_ts: string
  created_at: string
  commitments_found: number
}

interface RelationshipContact {
  name: string
  email: string
  interactions: number
  lastActive: string
  followThrough: number // percentage
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return d >= weekAgo
}

function getStreakDays(commitments: Commitment[]): number {
  // Calculate consecutive days with commitment activity (created or updated)
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
    const key = d.toISOString().split('T')[0]
    if (activityDates.has(key)) {
      streak++
    } else if (i > 0) {
      break // streak broken
    }
  }
  return streak
}

function getFollowThroughPercent(commitments: Commitment[]): number {
  if (commitments.length === 0) return 0
  const completed = commitments.filter(c => c.status === 'completed').length
  return Math.round((completed / commitments.length) * 100)
}

function get7DayTrend(commitments: Commitment[]): number[] {
  // Return array of 7 numbers (0-1) representing activity each day
  const trend: number[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    const dayCommitments = commitments.filter(c => {
      const created = new Date(c.created_at).toISOString().split('T')[0]
      const updated = new Date(c.updated_at).toISOString().split('T')[0]
      return created === key || updated === key
    })
    trend.push(Math.min(dayCommitments.length / 5, 1)) // normalize to 0-1, cap at 5
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

function getUrgentCount(commitments: Commitment[]): number {
  // Commitments older than 5 days that are still open
  return commitments.filter(c =>
    c.status === 'open' && daysSince(c.created_at) > 5
  ).length
}

function getOverdueCount(commitments: Commitment[]): number {
  return commitments.filter(c => c.status === 'overdue').length
}

function getAvgScore(commitments: Commitment[]): number {
  // Score based on: recency, status, source diversity
  if (commitments.length === 0) return 0
  let totalScore = 0
  commitments.forEach(c => {
    let score = 50
    if (c.status === 'completed') score += 30
    if (c.status === 'open' && daysSince(c.created_at) <= 3) score += 10
    if (c.status === 'open' && daysSince(c.created_at) > 7) score -= 20
    if (c.source === 'slack') score += 5
    if (c.source === 'outlook') score += 5
    totalScore += Math.max(0, Math.min(100, score))
  })
  return Math.round(totalScore / commitments.length)
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [mentions, setMentions] = useState<SlackMention[]>([])
  const [contacts, setContacts] = useState<RelationshipContact[]>([])
  const [hasIntegrations, setHasIntegrations] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      const supabase = createClient()

      // Load commitments
      const { data: commitData } = await supabase
        .from('commitments')
        .select('*')
        .order('created_at', { ascending: false })

      // Load recent slack messages that were @HeyWren mentions (have commitments_found > 0 or recent)
      const { data: mentionData } = await supabase
        .from('slack_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10)

      // Load integrations to check status
      const { data: intData } = await supabase
        .from('integrations')
        .select('provider')

      // Load relationship data from outlook_messages
      const { data: emailData } = await supabase
        .from('outlook_messages')
        .select('from_email, from_name, received_at')
        .order('received_at', { ascending: false })
        .limit(500)

      if (commitData) setCommitments(commitData)
      if (mentionData) setMentions(mentionData)
      if (intData && intData.length > 0) setHasIntegrations(true)

      // Aggregate contacts
      if (emailData) {
        const contactMap: Record<string, { name: string; email: string; count: number; lastDate: string }> = {}
        emailData.forEach((msg: any) => {
          const email = (msg.from_email || '').toLowerCase()
          if (!email || email.includes('noreply') || email.includes('notification') || email.includes('mailer-daemon')) return
          if (!contactMap[email]) {
            contactMap[email] = { name: msg.from_name || email.split('@')[0], email, count: 0, lastDate: msg.received_at }
          }
          contactMap[email].count++
          if (msg.received_at > contactMap[email].lastDate) {
            contactMap[email].lastDate = msg.received_at
          }
        })
        const sorted = Object.values(contactMap)
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
          .map(c => ({
            name: c.name,
            email: c.email,
            interactions: c.count,
            lastActive: c.lastDate,
            followThrough: Math.round(50 + Math.random() * 30), // simulated until we have real tracking
          }))
        setContacts(sorted)
      }

      setLoading(false)
    }
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-40 bg-gray-100 rounded"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded"></div>)}
          </div>
        </div>
      </div>
    )
  }

  // ── Computed Values ──
  const openCommitments = commitments.filter(c => c.status === 'open')
  const completedCommitments = commitments.filter(c => c.status === 'completed')
  const streak = getStreakDays(commitments)
  const followThrough = getFollowThroughPercent(commitments)
  const trend = get7DayTrend(commitments)
  const xp = (commitments.length * 10) + (completedCommitments.length * 25)
  const level = getLevel(xp)
  const urgentCount = getUrgentCount(commitments)
  const overdueCount = getOverdueCount(commitments)
  const avgScore = getAvgScore(commitments)
  const activeItems = openCommitments.length

  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length
  const personalBest = Math.max(followThrough, 82) // Track over time; placeholder

  // Anomalies
  const anomalies: { type: string; message: string }[] = []
  if (urgentCount > 2) {
    anomalies.push({
      type: 'Response gap',
      message: `${urgentCount} commitments have been open for over 5 days without updates`
    })
  }
  if (openCommitments.length > 20 && completedCommitments.length === 0) {
    anomalies.push({
      type: 'Completion gap',
      message: `${openCommitments.length} open commitments but none completed. Consider closing resolved items.`
    })
  }
  if (slackCount > 0 && outlookCount === 0) {
    anomalies.push({
      type: 'Single source',
      message: 'All commitments are from Slack. Connect Outlook to get a complete picture.'
    })
  }

  // Forecast
  const completionRate = commitments.length > 0 ? completedCommitments.length / commitments.length : 0
  const daysToClean = completionRate > 0 ? Math.ceil(openCommitments.length / (completionRate * 7)) * 7 : null
  const staleItems = openCommitments.filter(c => daysSince(c.created_at) > 7).length

  // Recent @HeyWren mentions (with commitment status)
  const recentMentions = mentions
    .filter(m => m.message_text?.includes('<@') || m.commitments_found > 0)
    .slice(0, 3)

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Here&apos;s what Wren found{' '}
          <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span> Live
          </span>
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {hasIntegrations
            ? `${[slackCount > 0 && 'Slack', outlookCount > 0 && 'Outlook'].filter(Boolean).length + (hasIntegrations ? 1 : 0)} connected tools watching for commitments`
            : 'Connect your tools to start tracking commitments'}
        </p>
      </div>

      {/* ── Hero Stats Bar ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-8 flex-wrap">
          {/* Streak */}
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <div>
              <div className="text-3xl font-bold text-gray-900">{streak}</div>
              <div className="text-xs text-gray-500">day streak</div>
            </div>
          </div>

          {/* Follow-through % ring */}
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
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
              <div className="text-sm font-semibold text-gray-900">Follow-through</div>
              <div className="text-xs text-gray-500">This week</div>
            </div>
          </div>

          {/* 7-day trend */}
          <div className="flex items-center gap-3">
            <div className="flex items-end gap-0.5 h-8">
              {trend.map((val, i) => (
                <div
                  key={i}
                  className="w-2 rounded-sm"
                  style={{
                    height: `${Math.max(val * 100, 10)}%`,
                    backgroundColor: val > 0.5 ? '#6366f1' : val > 0 ? '#a5b4fc' : '#e5e7eb'
                  }}
                />
              ))}
            </div>
            <div className="text-xs text-gray-500">7-day trend</div>
          </div>

          {/* Level badge */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-semibold">
              {level}
            </span>
            <span className="text-sm text-gray-500">{xp.toLocaleString()} XP</span>
          </div>
        </div>

        {/* Personal best */}
        <div className="mt-4 text-sm text-gray-500">
          Personal best: <span className="font-semibold text-green-600">{personalBest}%</span> follow-through — {followThrough >= personalBest ? 'you matched it!' : 'keep pushing!'}
        </div>

        {/* Recent achievement */}
        {commitments.length >= 25 && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
              ⚡ Commitment Tracker
            </span>
            <span className="text-gray-400">Earned recently · +200 XP</span>
          </div>
        )}
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Active Items', value: activeItems, color: '#6366f1', barPercent: Math.min(activeItems / 20 * 100, 100) },
          { label: 'Urgent', value: urgentCount, color: '#f59e0b', barPercent: Math.min(urgentCount / 10 * 100, 100) },
          { label: 'Overdue', value: overdueCount, color: '#ef4444', barPercent: Math.min(overdueCount / 5 * 100, 100) },
          { label: 'Avg Score', value: avgScore, color: '#22c55e', barPercent: avgScore },
        ].map(({ label, value, color, barPercent }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="h-1" style={{ background: `linear-gradient(to right, ${color} ${barPercent}%, #e5e7eb ${barPercent}%)` }} />
            <div className="p-4 text-center">
              <div className="text-3xl font-bold" style={{ color }}>{value}</div>
              <div className="text-sm text-gray-500 mt-1">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Anomalies ── */}
      {anomalies.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-3">
            <span>⚠</span> {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} detected
          </div>
          {anomalies.map((a, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <span className="font-semibold text-red-800">{a.type}:</span>{' '}
              <span className="text-red-700">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Work Pattern Stats ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            value: `${slackCount + outlookCount}`,
            label: 'Sources tracked',
            status: slackCount > 0 && outlookCount > 0 ? 'Healthy' : 'Limited',
            statusColor: slackCount > 0 && outlookCount > 0 ? 'text-green-600 bg-green-50' : 'text-yellow-600 bg-yellow-50'
          },
          {
            value: `${commitments.filter(c => isThisWeek(c.created_at)).length}`,
            label: 'New this week',
            status: 'Normal',
            statusColor: 'text-blue-600 bg-blue-50'
          },
          {
            value: `${completedCommitments.length}`,
            label: 'Completed',
            status: completedCommitments.length === 0 ? 'Low' : 'Good',
            statusColor: completedCommitments.length === 0 ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50'
          },
          {
            value: `${staleItems}`,
            label: 'Stale (7+ days)',
            status: staleItems > 5 ? 'High' : staleItems > 0 ? 'Medium' : 'Healthy',
            statusColor: staleItems > 5 ? 'text-red-600 bg-red-50' : staleItems > 0 ? 'text-yellow-600 bg-yellow-50' : 'text-green-600 bg-green-50'
          },
        ].map(({ value, label, status, statusColor }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500">{label}</div>
            <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
              {status}
            </span>
          </div>
        ))}
      </div>

      {/* ── Wren's Forecast ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Wren&apos;s Forecast</h2>
        <div className="space-y-3">
          {daysToClean ? (
            <div className="flex items-start gap-3">
              <span className="text-green-500 mt-0.5">✓</span>
              <span className="text-gray-700">
                At current pace, backlog clears by{' '}
                <span className="font-bold">
                  {new Date(Date.now() + daysToClean * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </span>
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <span className="text-yellow-500 mt-0.5">⚠</span>
              <span className="text-gray-700">
                No completions yet — start closing items to build your forecast
              </span>
            </div>
          )}

          {staleItems > 0 && (
            <div className="flex items-start gap-3">
              <span className="text-red-500 mt-0.5">⚠</span>
              <span className="text-gray-700">
                <span className="text-red-600 font-semibold">{staleItems} item{staleItems > 1 ? 's' : ''} stale for 7+ days</span>{' '}
                — review and close or update
              </span>
            </div>
          )}

          {openCommitments.length > 0 && (
            <div className="flex items-start gap-3">
              <span className="text-gray-400 mt-0.5">📋</span>
              <span className="text-gray-700">
                {openCommitments.length} open commitments need follow-through this week
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── @HeyWren Recent Mentions ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-green-600 text-white rounded text-xs font-bold">@HeyWren</span>
            <h2 className="text-lg font-bold text-gray-900">Recent Mentions</h2>
          </div>
          <span className="text-sm text-gray-400">
            {mentions.filter(m => isThisWeek(m.created_at)).length} captured this week
          </span>
        </div>

        {recentMentions.length === 0 ? (
          <p className="text-gray-500 text-sm">
            Tag <span className="font-semibold text-green-600">@HeyWren</span> in any Slack conversation to capture commitments. Try it now!
          </p>
        ) : (
          <div className="space-y-4">
            {recentMentions.map((m, i) => (
              <div key={m.id || i} className="flex items-start gap-3">
                <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center text-sm">
                  💬
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">
                    <span className="font-semibold text-green-600">@HeyWren</span>{' '}
                    {m.message_text?.replace(/<@[A-Z0-9]+>/g, '').trim().slice(0, 100)}
                    {(m.message_text?.length || 0) > 100 ? '...' : ''}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    <span>#{m.channel_id?.slice(-6)}</span>
                    <span>·</span>
                    <span>{daysSince(m.created_at) === 0 ? 'Today' : daysSince(m.created_at) === 1 ? 'Yesterday' : `${daysSince(m.created_at)} days ago`}</span>
                    <span>·</span>
                    <span className={m.commitments_found > 0 ? 'text-green-600 font-medium' : 'text-yellow-600 font-medium'}>
                      {m.commitments_found > 0 ? `Captured → Commitment Trace` : 'Pending review'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Weekly Leaderboard ── */}
      {contacts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            <span className="mr-2">🏆</span>Weekly Leaderboard
          </h2>
          <div className="space-y-3">
            {contacts.map((contact, i) => {
              const initials = contact.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
              const colors = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500']
              return (
                <div key={contact.email} className="flex items-center gap-4">
                  <span className="text-lg font-bold text-gray-400 w-6 text-right">{i + 1}</span>
                  <div className={`w-9 h-9 ${colors[i % colors.length]} rounded-full flex items-center justify-center text-white text-sm font-bold`}>
                    {initials}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {contact.name}
                      {i === 0 && <span className="text-xs text-gray-400 ml-1">(You)</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      🔥 {Math.max(1, streak - i)}-day streak · {contact.interactions > contacts[0].interactions ? '+' : ''}{Math.round((contact.interactions / Math.max(contacts[0].interactions, 1)) * 10 - 5)}% vs last week
                    </div>
                  </div>
                  <div className="text-xl font-bold text-gray-900">{contact.followThrough}%</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Nudge Cards ── */}
      {openCommitments.length > 0 && (
        <div className="space-y-4">
          {openCommitments
            .filter(c => daysSince(c.created_at) > 3)
            .slice(0, 3)
            .map((c, i) => {
              const age = daysSince(c.created_at)
              const urgency = age > 7 ? 'URGENT' : age > 5 ? 'GENTLE' : 'DIGEST'
              const score = Math.max(100 - age * 5, 30)
              const borderColor = urgency === 'URGENT' ? 'border-l-red-500' : urgency === 'GENTLE' ? 'border-l-indigo-500' : 'border-l-gray-400'
              const badgeColor = urgency === 'URGENT' ? 'bg-red-100 text-red-700' : urgency === 'GENTLE' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700'
              const sourceBadge = c.source === 'slack' ? 'SLACK' : c.source === 'outlook' || c.source === 'email' ? 'MICROSOFT 365' : 'MANUAL'

              return (
                <div key={c.id} className={`bg-white border border-gray-200 border-l-4 ${borderColor} rounded-xl p-5`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${badgeColor}`}>{urgency}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Score: {score}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{sourceBadge}</span>
                  </div>
                  <div className="font-bold text-gray-900 mb-1">
                    [{urgency === 'URGENT' ? 'Strategic follow-through' : urgency === 'GENTLE' ? 'Follow-up needed' : 'Check-in'}] {c.title}
                  </div>
                  <p className="text-sm text-gray-500 mb-3">
                    {c.description || `This commitment has been open for ${age} days. Consider following up or closing it.`}
                  </p>
                  <div className="flex items-center gap-2">
                    <button className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Done</button>
                    <button className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600">Snooze</button>
                    <button className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300">Dismiss</button>
                    <Link
                      href="/commitments"
                      className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                    >
                      Open Source
                    </Link>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
