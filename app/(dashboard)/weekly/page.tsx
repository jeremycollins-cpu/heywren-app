'use client'

import { Calendar, CheckCircle2, TrendingUp, AlertCircle } from 'lucide-react'

export default function WeeklyPage() {
  const stats = [
    { label: 'Completed', value: 18, color: 'text-green-600', icon: CheckCircle2 },
    { label: 'In Progress', value: 7, color: 'text-blue-600', icon: TrendingUp },
    { label: 'At Risk', value: 3, color: 'text-red-600', icon: AlertCircle },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Weekly Review</h1>
        <p className="text-gray-600 mt-1">
          Your personal pulse check — what got done, what moved forward, where to focus next
        </p>
      </div>

      {/* Week Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color} mt-2`}>{stat.value}</p>
                </div>
                <Icon className={`w-10 h-10 opacity-20 ${stat.color}`} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Weekly Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">This Week's Highlights</h2>
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Closed Q2 revenue goal</p>
                <p className="text-sm text-gray-600 mt-1">Sales team exceeded monthly target by 8%</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Product launch completed</p>
                <p className="text-sm text-gray-600 mt-1">New dashboard shipped with positive user feedback</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2 flex-shrink-0" />
              <div>
                <p className="font-medium text-gray-900">Board prep delayed</p>
                <p className="text-sm text-gray-600 mt-1">Needs to be rescheduled from Friday to next Tuesday</p>
              </div>
            </div>
          </div>
        </div>

        <hr className="border-gray-200" />

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Focus for Next Week</h2>
          <ul className="space-y-2 text-gray-700">
            <li className="flex gap-2">
              <span className="text-indigo-600">→</span> Finalize investor deck for board meeting
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600">→</span> Review product roadmap with engineering
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600">→</span> Customer success call with top 3 accounts
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600">→</span> Resolve team scheduling conflicts
            </li>
          </ul>
        </div>

        <hr className="border-gray-200" />

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Follow-Through Rate</p>
              <p className="text-2xl font-bold text-gray-900">94%</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Avg Response Time</p>
              <p className="text-2xl font-bold text-gray-900">2.1h</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Commitments Met</p>
              <p className="text-2xl font-bold text-gray-900">43/45</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">Week Productivity</p>
              <p className="text-2xl font-bold text-gray-900">+12%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
