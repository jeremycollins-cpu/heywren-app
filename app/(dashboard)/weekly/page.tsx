'use client'

import { Calendar, CheckCircle2, TrendingUp, AlertCircle } from 'lucide-react'

export default function WeeklyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Weekly Review</h1>
        <p className="text-gray-600 mt-1">
          Your personal pulse check — what got done, what moved forward, where to focus next
        </p>
      </div>

      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
          <Calendar className="w-8 h-8 text-indigo-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No weekly review yet</h3>
        <p className="text-gray-500 max-w-md mb-6">
          Your first weekly review will appear after you've created and tracked commitments for a full week. This gives HeyWren enough data to generate meaningful insights.
        </p>
        <a href="/commitments" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Create Your First Commitment
        </a>
      </div>
    </div>
  )
}
