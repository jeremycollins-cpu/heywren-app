'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Brain, AlertCircle, CheckCircle2, Clock, TrendingUp } from 'lucide-react'

interface Signal {
  id: string
  coach: string
  signal: string
  description: string
  severity: 'high' | 'medium' | 'low'
}

interface CoachProfile {
  id: string
  title: string
  icon: string
  bg: string
  focuses: string[]
  signals: string[]
}

const coaches: CoachProfile[] = [
  {
    id: 'executive',
    title: 'Executive Coach',
    icon: '🧠',
    bg: 'bg-indigo-50 border-indigo-200',
    focuses: ['Board & investor readiness', 'Delegation patterns', 'Strategic focus', 'Culture amplification'],
    signals: ['Board prep gaps', 'Over-indexing on ops', 'Unresolved people issues', 'Commitment governance'],
  },
  {
    id: 'revenue',
    title: 'Revenue Coach',
    icon: '📈',
    bg: 'bg-blue-50 border-blue-200',
    focuses: ['Pipeline velocity', 'Deal progression', 'Forecast accuracy', 'Customer expansion'],
    signals: ['Stalled deals', 'Unlogged activities', 'Missed follow-ups', 'Reps going dark'],
  },
  {
    id: 'growth',
    title: 'Growth Coach',
    icon: '🚀',
    bg: 'bg-purple-50 border-purple-200',
    focuses: ['Campaign execution', 'Content pipeline', 'Cross-functional alignment', 'Budget tracking'],
    signals: ['Stalled campaigns', 'Missed deadlines', 'Misaligned messaging', 'Launch gaps'],
  },
  {
    id: 'delivery',
    title: 'Delivery Coach',
    icon: '🔧',
    bg: 'bg-green-50 border-green-200',
    focuses: ['Sprint execution', 'Tech debt management', 'Team health', 'Dependency tracking'],
    signals: ['Blocked PRs', 'Stalled sprints', 'Tech debt', 'Team sentiment shifts'],
  },
  {
    id: 'retention',
    title: 'Retention Coach',
    icon: '🛡️',
    bg: 'bg-cyan-50 border-cyan-200',
    focuses: ['Renewal pipeline', 'NPS tracking', 'Expansion opportunities', 'Onboarding rates'],
    signals: ['At-risk accounts', 'Unanswered escalations', 'Stalled onboarding', 'Usage drop-off'],
  },
  {
    id: 'execution',
    title: 'Execution Coach',
    icon: '⚡',
    bg: 'bg-red-50 border-red-200',
    focuses: ['Deliverable tracking', 'Process compliance', 'Resource allocation', 'Timeline adherence'],
    signals: ['Missed deadlines', 'Resource conflicts', 'Vendor non-response', 'Alignment gaps'],
  },
]

export default function CoachPage() {
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, open: 0, completed: 0 })

  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: commitments } = await supabase
          .from('commitments')
          .select('id, title, status, source, created_at')

        const all = commitments || []
        const open = all.filter(c => c.status === 'open')
        const completed = all.filter(c => c.status === 'completed')

        setStats({
          total: all.length,
          open: open.length,
          completed: completed.length,
        })

        // Generate signals based on actual data patterns
        const generatedSignals: Signal[] = []

        if (open.length > 10) {
          generatedSignals.push({
            id: '1',
            coach: 'Execution Coach',
            signal: 'High open count',
            description: `You have ${open.length} open commitments. Consider prioritizing and closing some out to avoid overload.`,
            severity: 'high',
          })
        }

        if (open.length > 0 && completed.length === 0) {
          generatedSignals.push({
            id: '2',
            coach: 'Executive Coach',
            signal: 'No completions yet',
            description: 'You have commitments tracked but none marked complete. Start closing items to build momentum and follow-through habits.',
            severity: 'medium',
          })
        }

        const slackCommitments = all.filter(c => c.source === 'slack')
        const outlookCommitments = all.filter(c => c.source === 'outlook')

        if (outlookCommitments.length > 0 && slackCommitments.length === 0) {
          generatedSignals.push({
            id: '3',
            coach: 'Growth Coach',
            signal: 'Missing Slack data',
            description: 'You have commitments from email but none from Slack. Sync Slack to get a more complete picture of your commitments.',
            severity: 'low',
          })
        }

        if (slackCommitments.length > 0 && outlookCommitments.length === 0) {
          generatedSignals.push({
            id: '4',
            coach: 'Revenue Coach',
            signal: 'Missing email data',
            description: 'You have commitments from Slack but none from email. Sync Outlook to capture email-based commitments.',
            severity: 'low',
          })
        }

        // Check for old open commitments
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const stale = open.filter(c => c.created_at < oneWeekAgo)
        if (stale.length > 3) {
          generatedSignals.push({
            id: '5',
            coach: 'Delivery Coach',
            signal: 'Stale commitments',
            description: `${stale.length} commitments are more than a week old and still open. Review these and either complete, delegate, or close them.`,
            severity: 'high',
          })
        }

        if (all.length >= 10) {
          const completionRate = completed.length / all.length
          if (completionRate < 0.2) {
            generatedSignals.push({
              id: '6',
              coach: 'Executive Coach',
              signal: 'Low follow-through',
              description: `Only ${Math.round(completionRate * 100)}% of your commitments are completed. Focus on closing existing items before taking on new ones.`,
              severity: 'high',
            })
          } else if (completionRate > 0.7) {
            generatedSignals.push({
              id: '7',
              coach: 'Execution Coach',
              signal: 'Strong follow-through',
              description: `${Math.round(completionRate * 100)}% completion rate — excellent follow-through! Keep up the momentum.`,
              severity: 'low',
            })
          }
        }

        setSignals(generatedSignals)
      } catch (err) {
        console.error('Error fetching coach data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading coaching insights...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Coach</h1>
        <p className="text-gray-600 mt-1">
          AI coaching adapted to your role — get insights on what matters most
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-sm text-gray-600">Total Tracked</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{stats.open}</p>
          <p className="text-sm text-gray-600">Open</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-sm text-gray-600">Completed</p>
        </div>
      </div>

      {/* Active Signals */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">
          Active Signals
          {signals.length > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">
              {signals.length}
            </span>
          )}
        </h2>
        {signals.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">All clear!</p>
            <p className="text-sm text-gray-500 mt-1">No coaching signals right now. Keep up the good work.</p>
          </div>
        ) : (
          signals.map((signal) => (
            <div
              key={signal.id}
              className={`border-l-4 rounded-lg p-4 bg-white ${
                signal.severity === 'high'
                  ? 'border-red-500 bg-red-50'
                  : signal.severity === 'medium'
                  ? 'border-yellow-500 bg-yellow-50'
                  : 'border-green-500 bg-green-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                  signal.severity === 'high' ? 'text-red-600' : signal.severity === 'medium' ? 'text-yellow-600' : 'text-green-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{signal.coach}</span>
                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                      signal.severity === 'high'
                        ? 'bg-red-100 text-red-700'
                        : signal.severity === 'medium'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {signal.signal}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{signal.description}</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Coach Profiles Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Coaches</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {coaches.map((coach) => (
            <button
              key={coach.id}
              onClick={() => setSelectedCoach(selectedCoach === coach.id ? null : coach.id)}
              className={`border rounded-lg p-6 text-left transition-all ${
                selectedCoach === coach.id
                  ? `${coach.bg} border-2`
                  : `${coach.bg} border border-gray-200 hover:shadow-md`
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">{coach.icon}</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-3">{coach.title}</h3>

              {selectedCoach === coach.id && (
                <div className="mt-4 pt-4 border-t border-gray-300 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Focus Areas</p>
                    <ul className="space-y-1">
                      {coach.focuses.map((focus, i) => (
                        <li key={i} className="text-sm text-gray-700">• {focus}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Key Signals</p>
                    <ul className="space-y-1">
                      {coach.signals.map((signal, i) => (
                        <li key={i} className="text-sm text-gray-700">• {signal}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <div className="flex gap-4">
          <Brain className="w-6 h-6 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-indigo-900 mb-2">How the Coach Works</h3>
            <p className="text-sm text-indigo-800">
              Your coaches analyze your commitments, interactions, and activity patterns to surface signals that need attention. As more data flows in, the signals become more specific and actionable.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
