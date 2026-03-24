'use client'

import { useEffect, useState } from 'react'
import { Send, Edit, Trash2, MessageSquare, RefreshCw, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface Draft {
  id: string
  commitment_id: string | null
  recipient_name: string | null
  recipient_email: string | null
  channel: string
  subject: string
  body: string
  status: string
  created_at: string
  commitment?: {
    id: string
    title: string
    description: string | null
    source: string | null
    status: string
  } | null
}

export default function DraftQueuePage() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [selectedDraft, setSelectedDraft] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<string | null>(null)
  const [editSubject, setEditSubject] = useState('')
  const [editBody, setEditBody] = useState('')

  async function loadDrafts() {
    try {
      const res = await fetch('/api/drafts')
      const data = await res.json()
      if (data.drafts) {
        setDrafts(data.drafts.filter((d: Draft) => d.status === 'ready' || d.status === 'edited'))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load drafts'
      setError(message)
      toast.error(message)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadDrafts()
  }, [])

  async function generateDrafts() {
    setGenerating(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })
      const data = await res.json()

      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success(`Generated ${data.draftsCreated || 0} new drafts`)
        await loadDrafts()
      }
    } catch (err) {
      toast.error('Failed to generate drafts')
    }
    setGenerating(false)
  }

  async function sendDraft(id: string) {
    try {
      const res = await fetch('/api/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'sent' }),
      })
      if (res.ok) {
        setDrafts(drafts.filter(d => d.id !== id))
        toast.success('Draft marked as sent')
      }
    } catch {
      toast.error('Failed to send draft')
    }
  }

  async function dismissDraft(id: string) {
    try {
      const res = await fetch('/api/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'dismissed' }),
      })
      if (res.ok) {
        setDrafts(drafts.filter(d => d.id !== id))
        toast.success('Draft dismissed')
      }
    } catch {
      toast.error('Failed to dismiss draft')
    }
  }

  function startEditing(draft: Draft) {
    setEditingDraft(draft.id)
    setEditSubject(draft.subject)
    setEditBody(draft.body)
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch('/api/drafts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, subject: editSubject, body: editBody, status: 'edited' }),
      })
      if (res.ok) {
        setDrafts(drafts.map(d =>
          d.id === id ? { ...d, subject: editSubject, body: editBody, status: 'edited' } : d
        ))
        setEditingDraft(null)
        toast.success('Draft updated')
      }
    } catch {
      toast.error('Failed to save edit')
    }
  }

  const getChannelBadge = (channel: string) => {
    if (channel === 'slack') return 'bg-purple-100 text-purple-700'
    if (channel === 'email') return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-700'
  }

  if (loading) {
    return (
      <div className="p-8" role="status" aria-live="polite" aria-busy="true" aria-label="Loading drafts">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded"></div>)}
          </div>
        </div>
      </div>
    )
  }

  const readyCount = drafts.filter(d => d.status === 'ready').length
  const editedCount = drafts.filter(d => d.status === 'edited').length

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Draft Queue</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            HeyWren pre-writes follow-ups based on open commitments. Review, edit, and send when ready.
          </p>
        </div>
        <button
          onClick={generateDrafts}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
        >
          <RefreshCw aria-hidden="true" className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generating...' : 'Generate Drafts'}
        </button>
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Drafts</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{drafts.length}</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Ready to Send</p>
          <p className="text-3xl font-bold text-green-600">{readyCount}</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Edited</p>
          <p className="text-3xl font-bold text-indigo-600">{editedCount}</p>
        </div>
      </div>

      {/* Drafts List */}
      <div className="space-y-3">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No drafts yet</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
              Click "Generate Drafts" to have HeyWren create follow-up messages for your open commitments.
              Drafts are also generated automatically every morning at 7 AM PT.
            </p>
            <button
              onClick={generateDrafts}
              disabled={generating}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Drafts'}
            </button>
          </div>
        ) : (
          drafts.map((draft) => (
            <div
              key={draft.id}
              className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6 hover:shadow-md transition"
            >
              {editingDraft === draft.id ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm font-semibold dark:bg-surface-dark dark:text-white"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm dark:bg-surface-dark dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(draft.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm"
                    >
                      <Check aria-hidden="true" className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingDraft(null)}
                      className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition text-sm"
                    >
                      <X aria-hidden="true" className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <>
                  <div
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-expanded={selectedDraft === draft.id}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedDraft(selectedDraft === draft.id ? null : draft.id) } }}
                    onClick={() => setSelectedDraft(selectedDraft === draft.id ? null : draft.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${getChannelBadge(draft.channel)}`}>
                            {draft.channel}
                          </span>
                          {draft.status === 'edited' && (
                            <span className="px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
                              Edited
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(draft.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-1">{draft.subject}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{draft.body}</p>
                      </div>
                      {draft.recipient_name && (
                        <div className="text-right ml-4 flex-shrink-0">
                          <div className="text-xs text-gray-500 dark:text-gray-400">To</div>
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{draft.recipient_name}</div>
                        </div>
                      )}
                    </div>

                    {draft.commitment && (
                      <div className="text-xs text-gray-400 mt-1">
                        Re: {draft.commitment.title}
                      </div>
                    )}
                  </div>

                  {selectedDraft === draft.id && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <div className="bg-gray-50 dark:bg-surface-dark rounded-lg p-4 mb-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {draft.body}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => sendDraft(draft.id)}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                        >
                          <Send aria-hidden="true" className="w-4 h-4" />
                          Mark as Sent
                        </button>
                        <button
                          onClick={() => startEditing(draft)}
                          className="flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                        >
                          <Edit aria-hidden="true" className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={() => dismissDraft(draft.id)}
                          className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition"
                          aria-label="Dismiss draft"
                        >
                          <Trash2 aria-hidden="true" className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 mb-2">About Draft Queue</h3>
        <p className="text-sm text-indigo-800 dark:text-indigo-300 mb-3">
          HeyWren never sends messages on your behalf. Instead, it pre-writes thoughtful follow-ups based on your open commitments and context. You maintain full control.
        </p>
        <ul className="text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <li>&#10003; AI-generated drafts based on your real commitments</li>
          <li>&#10003; Full editor to customize before sending</li>
          <li>&#10003; New drafts generated daily at 7 AM PT</li>
          <li>&#10003; Click "Generate Drafts" anytime for fresh follow-ups</li>
        </ul>
      </div>
    </div>
  )
}
