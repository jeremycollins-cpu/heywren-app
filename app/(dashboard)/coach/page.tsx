'use client'

import { useState } from 'react'
import { Brain, AlertCircle, TrendingDown, MessageSquare } from 'lucide-react'

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

const alerts: any[] = []

export default function CoachPage() {
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Coach</h1>
        <p className="text-gray-600 mt-1">
          AI coaching adapted to your role — get insights on what matters most
        </p>
      </div>

      {/* Active Alerts - Empty State */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Active Signals</h2>
        {alerts.length === 0 ? (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-8 text-center">
            <p className="text-gray-600 mb-4">Your AI coaches are learning from your activity. Signals will appear once you have commitment and interaction data.</p>
            <p className="text-sm text-gray-500">Start by creating commitments or connecting integrations to activate your coaches.</p>
          </div>
        ) : (
          alerts.map((alert: any) => (
            <div
              key={alert.id}
              className={`border-l-4 rounded-lg p-4 bg-white ${
                alert.severity === 'high'
                  ? 'border-red-500 bg-red-50'
                  : 'border-yellow-500 bg-yellow-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                  alert.severity === 'high' ? 'text-red-600' : 'text-yellow-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900">{alert.coach}</span>
                    <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                      alert.severity === 'high'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {alert.signal}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{alert.description}</p>
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
                <>
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
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Coaching Tips */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <div className="flex gap-4">
          <Brain className="w-6 h-6 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-indigo-900 mb-2">How the Coach Works</h3>
            <p className="text-sm text-indigo-800 mb-3">
              Your coaches monitor commitments, interactions, and activity patterns to surface signals that matter for your role.
            </p>
            <ul className="text-sm text-indigo-800 space-y-1">
              <li>✓ Real-time signal detection across your calendar, messages, and tools</li>
              <li>✓ Personalized insights based on your specific role configuration</li>
              <li>✓ Actionable recommendations to improve follow-through</li>
              <li>✓ Weekly coaching summaries and progress tracking</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
