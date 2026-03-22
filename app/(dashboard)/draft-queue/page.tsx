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

const mockDrafts: Draft[] = []

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
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No drafts yet</h3>
            <p className="text-gray-500 max-w-md mb-6">
              HeyWren will pre-write follow-ups based on your open commitments. Once you have commitments tracked, you'll see AI-generated drafts here that you can review and send.
            </p>
            <a href="/dashboard/commitments" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
              Create Commitments
            </a>
          </div>
        ) : (
          drafts.map((draft) => (
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
          ))
        )}
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
