'use client'

import { useState } from 'react'
import { Send, Edit, Trash2, MessageSquare } from 'lucide-react'

interface Draft {
  id: string
  recipient: string
  channel: string
  subject: string
  preview: string
  createdAt: string
  status: 'ready' | 'pending' | 'scheduled'
}

const mockDrafts: Draft[] = [
  {
    id: '1',
    recipient: 'Sarah Chen',
    channel: '#sales',
    subject: 'Q2 Pipeline Review - Action Items',
    preview: 'Hi Sarah, following up on our Q2 review. We discussed 5 key action items...',
    createdAt: '2 hours ago',
    status: 'ready',
  },
  {
    id: '2',
    recipient: 'Michael Rodriguez',
    channel: 'Slack DM',
    subject: 'Budget Approval - FY2025 Plan',
    preview: 'Thanks for reviewing the budget proposal. As discussed, we\'re proposing...',
    createdAt: '4 hours ago',
    status: 'ready',
  },
  {
    id: '3',
    recipient: 'Product Team',
    channel: '#product',
    subject: 'Roadmap Update - Quarterly Goals',
    preview: 'Team, here\'s the updated roadmap incorporating feedback from...',
    createdAt: '1 day ago',
    status: 'pending',
  },
  {
    id: '4',
    recipient: 'Investor Group',
    channel: 'Email',
    subject: 'Board Meeting - Recap & Next Steps',
    preview: 'Thank you all for attending the board meeting. Attached is...',
    createdAt: '3 days ago',
    status: 'scheduled',
  },
  {
    id: '5',
    recipient: 'Emma Thompson',
    channel: 'Slack DM',
    subject: 'Code Review Feedback - PR #2847',
    preview: 'Thanks for submitting the PR. I\'ve reviewed the changes and have...',
    createdAt: '5 days ago',
    status: 'pending',
  },
]

export default function DraftQueuePage() {
  const [drafts, setDrafts] = useState(mockDrafts)
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null)

  const sendDraft = (id: string) => {
    setDrafts(drafts.filter(d => d.id !== id))
  }

  const deleteDraft = (id: string) => {
    setDrafts(drafts.filter(d => d.id !== id))
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'bg-green-100 text-green-700'
      case 'pending':
        return 'bg-yellow-100 text-yellow-700'
      case 'scheduled':
        return 'bg-blue-100 text-blue-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Draft Queue</h1>
        <p className="text-gray-600 mt-1">
          HeyWren pre-writes follow-ups based on open commitments. Review, edit, and send when ready.
        </p>
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Total Drafts</p>
          <p className="text-3xl font-bold text-gray-900">{drafts.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Ready to Send</p>
          <p className="text-3xl font-bold text-green-600">{drafts.filter(d => d.status === 'ready').length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">This Week</p>
          <p className="text-3xl font-bold text-indigo-600">{Math.floor(drafts.length * 0.6)}</p>
        </div>
      </div>

      {/* Drafts List */}
      <div className="space-y-3">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            onClick={() => setSelectedDraft(selectedDraft === draft.id ? null : draft.id)}
            className="bg-white border border-gray-200 rounded-lg p-6 cursor-pointer hover:shadow-md transition"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(draft.status)}`}>
                    {draft.status.charAt(0).toUpperCase() + draft.status.slice(1)}
                  </span>
                  <span className="text-xs text-gray-500">{draft.createdAt}</span>
                </div>
                <h3 className="font-semibold text-gray-900 line-clamp-1">{draft.subject}</h3>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{draft.preview}</p>
              </div>
              <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">
                  {draft.channel}
                </span>
              </div>
            </div>

            {selectedDraft === draft.id && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    sendDraft(draft.id)
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteDraft(draft.id)
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 mb-2">About Draft Queue</h3>
        <p className="text-sm text-indigo-800 mb-3">
          HeyWren never sends messages on your behalf. Instead, it pre-writes thoughtful follow-ups based on your open commitments and context. You maintain full control.
        </p>
        <ul className="text-sm text-indigo-800 space-y-1">
          <li>✓ AI-generated drafts with 95%+ send rate</li>
          <li>✓ Full editor to customize before sending</li>
          <li>✓ Works with Slack, Email, and other integrations</li>
          <li>✓ Scheduled sends and snooze reminders</li>
        </ul>
      </div>
    </div>
  )
}
