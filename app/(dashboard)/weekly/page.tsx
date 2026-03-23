'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Calendar, CheckCircle2, TrendingUp, AlertCircle, Clock, Zap } from 'lucide-react'

interface WeeklyData {
  totalCommitments: number
  openCommitments: number
  completedThisWeek: number
  newThisWeek: number
  slackCount: number
  outlookCount: number
  recentCommitments: Array<{
    id: string
    title: string
    status: string
    source: string
    created_at: string
  }>
}

export default function WeeklyPage() {
  const [data, setData] = useState<WeeklyData | null>(null)
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const fetchWeeklyData = async () => {
      try {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

        // Get all commitments
        const { data: allCommitments } = await supabase
          .from('commitments')
          .select('id, title, status, source, created_at')
          .order('created_at', { ascending: false })

        const all = allCommitments || []
        const thisWeek = all.filter(c => c.created_at >= oneWeekAgo)

        setData({
          totalCommitments: all.length,
          openCommitments: all.filter(c => c.status === 'open').length,
          completedThisWeek: all.filter(c => c.status === 'completed' && c.created_at >= oneWeekAgo).length,
          newThisWeek: thisWeek.length,
          slackCount: all.filter(c => c.source === 'slack').length,
          outlookCount: all.filter(c => c.source === 'outlook').length,
          recentCommitments: all.slice(0, 10),
        })
      } catch (err) {
        console.error('Error fetching weekly data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchWeeklyData()
  }, [supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading weekly review...</p>
      </div>
    )
  }

  if (!data || data.totalCommitments === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Weekly Review</h1>
          <p className="text-gray-600 mt-1">
            Your personal pulse check — what got done, what moved forward, where to focus next
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <Calendar className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No weekly review yet</h3>
          <p className="text-gray-500 max-w-md mb-6">
            Sync your integrations to start tracking commitments. Your weekly review will summarize activity once data flows in.
          </p>
          <a href="/sync" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Sync Now
          </a>
        </div>
      </div>
    )
  }

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' - ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Weekly Review</h1>
        <p className="text-gray-600 mt-1">
          Week of {weekLabel}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="w-5 h-5 text-blue-600" />
            <p className="text-sm text-gray-600">New This Week</p>
          </div>
          <p className="text-3xl font-bold text-gray-900">{data.newThisWeek}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <p className="text-sm text-gray-600">Completed</p>
          </div>
          <p className="text-3xl font-bold text-green-600">{data.completedThisWeek}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <Clock className="w-5 h-5 text-yellow-600" />
            <p className="text-sm text-gray-600">Still Open</p>
          </div>
          <p className="text-3xl font-bold text-yellow-600">{data.openCommitments}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            <p className="text-sm text-gray-600">Total Tracked</p>
          </div>
          <p className="text-3xl font-bold text-indigo-600">{data.totalCommitments}</p>
        </div>
      </div>

      {/* Source Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sources</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-lg">
            <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">#</span>
            </div>
            <div>
              <p className="text-sm text-gray-600">Slack</p>
              <p className="text-2xl font-bold text-gray-900">{data.slackCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">@</span>
            </div>
            <div>
              <p className="text-sm text-gray-600">Outlook</p>
              <p className="text-2xl font-bold text-gray-900">{data.outlookCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Focus for Next Week */}
      {data.openCommitments > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900">Focus for Next Week</h3>
              <p className="text-sm text-yellow-800 mt-1">
                You have {data.openCommitments} open commitment{data.openCommitments !== 1 ? 's' : ''} to follow through on.
                Review your commitments and prioritize which ones to close out this week.
              </p>
              <a href="/commitments" className="inline-block mt-3 text-sm font-medium text-yellow-900 hover:underline">
                View open commitments →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {data.recentCommitments.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-b-0">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${c.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`} />
                <span className="text-sm text-gray-900">{c.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs ${c.source === 'slack' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {c.source}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
