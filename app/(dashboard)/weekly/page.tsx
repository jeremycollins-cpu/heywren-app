// app/(dashboard)/weekly/page.tsx
// Weekly Review v4 — SECURITY FIX: All queries filtered by team_id
// Matches demo with Meeting ROI section, weekly pulse

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Commitment {
  id: string
  title: string
  status: string
  source: string | null
  created_at: string
  updated_at: string
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function isThisWeek(dateStr: string): boolean {
  return daysSince(dateStr) <= 7
}

// Simulated meeting data — will be real when calendar integration is connected
function generateMeetingROI(commitments: Commitment[]) {
  const slackCommitments = commitments.filter(c => c.source === 'slack')
  const emailCommitments = commitments.filter(c => c.source === 'outlook' || c.source === 'email')
  const completed = commitments.filter(c => c.status === 'completed')
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0

  return [
    {
      name: 'Team Standup',
      score: Math.min(95, 60 + Math.round(slackCommitments.length * 0.5)),
      actionsPerWeek: Math.max(1, Math.round(slackCommitments.length / 4 * 10) / 10),
      followThrough: Math.min(95, followThrough + 15),
      recommendation: followThrough > 60 ? 'Keep' : 'Optimize',
      recColor: followThrough > 60 ? 'text-green-600' : 'text-yellow-600',
    },
    {
      name: 'Leadership Sync',
      score: Math.min(95, 65 + Math.round(emailCommitments.length * 0.3)),
      actionsPerWeek: Math.max(1, Math.round((slackCommitments.length + emailCommitments.length) / 6 * 10) / 10),
      followThrough: Math.min(95, followThrough + 20),
      recommendation: 'Keep',
      recColor: 'text-green-600',
    },
    {
      name: '1:1 Block',
      score: Math.min(95, 70 + Math.round(commitments.length * 0.2)),
      actionsPerWeek: Math.max(2, Math.round(commitments.length / 3 * 10) / 10),
      followThrough: Math.min(95, followThrough + 25),
      recommendation: 'Keep',
      recColor: 'text-green-600',
    },
    {
      name: 'All-Hands',
      score: Math.max(20, 40 - Math.round(commitments.length * 0.1)),
      actionsPerWeek: 0.3,
      followThrough: Math.max(10, followThrough - 20),
      recommendation: 'Go Async',
      recColor: 'text-orange-600',
    },
    {
      name: 'Planning Session',
      score: Math.min(80, 50 + Math.round(commitments.length * 0.15)),
      actionsPerWeek: Math.max(1, Math.round(commitments.length / 5 * 10) / 10),
      followThrough: Math.min(90, followThrough + 10),
      recommendation: commitments.length > 50 ? 'Keep' : 'Optimize',
      recColor: commitments.length > 50 ? 'text-green-600' : 'text-yellow-600',
    },
  ]
}

function getScoreRingColor(score: number): string {
  if (score >= 75) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

export default function WeeklyPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
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

      const { data } = await supabase
        .from('commitments')
        .select('*')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })
      if (data) setCommitments(data)
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-100 rounded"></div>
        </div>
      </div>
    )
  }

  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const thisWeek = commitments.filter(c => isThisWeek(c.created_at))
  const completedThisWeek = commitments.filter(c => c.status === 'completed' && isThisWeek(c.updated_at))
  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0

  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length

  const meetings = generateMeetingROI(commitments)

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Weekly Review</h1>
        <p className="text-gray-500 text-sm mt-1">Your personal pulse check — what got done, what moved forward, where to focus next</p>
        <p className="text-gray-400 text-xs mt-0.5">{weekLabel}</p>
      </div>

      {/* Weekly Summary Banner */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
        <p className="text-gray-600">
          Your weekly review generates every Friday. It will include accomplishments, activity metrics, and a preview of next week — all personalized for your role.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: '⚡', label: 'New This Week', value: thisWeek.length, color: 'text-gray-900' },
          { icon: '✅', label: 'Completed', value: completedThisWeek.length, color: completedThisWeek.length > 0 ? 'text-green-600' : 'text-yellow-600' },
          { icon: '⏰', label: 'Still Open', value: open.length, color: open.length > 20 ? 'text-yellow-600' : 'text-gray-900' },
          { icon: '📈', label: 'Follow-through', value: `${followThrough}%`, color: followThrough >= 50 ? 'text-green-600' : 'text-red-600' },
        ].map(({ icon, label, value, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
              <span>{icon}</span> {label}
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Meeting ROI This Week */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Meeting ROI This Week</h2>
        <div className="space-y-3">
          {meetings.map(meeting => (
            <div key={meeting.name} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
              {/* Score Ring */}
              <div className="relative w-14 h-14 flex-shrink-0">
                <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                  <circle
                    cx="28" cy="28" r="24" fill="none"
                    stroke={getScoreRingColor(meeting.score)}
                    strokeWidth="3"
                    strokeDasharray={`${(meeting.score / 100) * 150.8} 150.8`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-gray-900">{meeting.score}</span>
                </div>
              </div>

              {/* Info */}
              <div className="flex-1">
                <div className="font-semibold text-gray-900">{meeting.name}</div>
                <div className="text-sm text-gray-500">
                  {meeting.actionsPerWeek} action items/week · {meeting.followThrough}% follow-through
                </div>
              </div>

              {/* Recommendation */}
              <span className={`text-sm font-semibold ${meeting.recColor}`}>
                {meeting.recommendation}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sources */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Sources</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 bg-purple-50 rounded-lg p-3">
            <div className="w-8 h-8 bg-purple-500 rounded flex items-center justify-center text-white text-sm font-bold">#</div>
            <div>
              <div className="text-sm text-gray-500">Slack</div>
              <div className="text-xl font-bold text-gray-900">{slackCount}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-3">
            <div className="w-8 h-8 bg-blue-500 rounded flex items-center justify-center text-white text-sm font-bold">@</div>
            <div>
              <div className="text-sm text-gray-500">Outlook</div>
              <div className="text-xl font-bold text-gray-900">{outlookCount}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Recent Activity</h2>
        <div className="space-y-3">
          {commitments.slice(0, 8).map(c => (
            <div key={c.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.status === 'completed' ? 'bg-green-500' : 'bg-indigo-500'}`} />
                <span className="text-sm text-gray-700">{c.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span className={`px-1.5 py-0.5 rounded font-medium ${
                  c.source === 'slack' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {c.source || 'manual'}
                </span>
                <span>{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
