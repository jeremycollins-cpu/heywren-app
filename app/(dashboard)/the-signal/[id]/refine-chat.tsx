'use client'

// Chat-to-refine pane. Sends the user's message plus (optionally) the id of
// the section they're focused on. The API may return a section update which
// the parent applies atomically.

import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, Loader2, Target } from 'lucide-react'
import toast from 'react-hot-toast'
import type { BriefingMessage, BriefingSection } from '@/lib/monthly-briefing/types'

interface Props {
  briefingId: string
  messages: BriefingMessage[]
  activeSection: BriefingSection | null
  onMessageAppended: (message: BriefingMessage) => void
  onSectionUpdated: (section: BriefingSection) => void
  onSectionDeleted: (sectionId: string) => void
  disabled: boolean
}

const SUGGESTIONS = [
  'Make this section more candid',
  "What's missing from this briefing?",
  'Add a section about team health',
  'Tighten the Risks section — fewer bullets',
]

export default function RefineChat({
  briefingId,
  messages,
  activeSection,
  onMessageAppended,
  onSectionUpdated,
  onSectionDeleted,
  disabled,
}: Props) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sending])

  const send = async (text?: string) => {
    const message = (text ?? input).trim()
    if (!message || sending || disabled) return

    // Optimistic user message (server will also persist)
    const now = new Date().toISOString()
    onMessageAppended({
      id: `local-${now}`,
      briefing_id: briefingId,
      user_id: '',
      role: 'user',
      content: message,
      target_section_id: activeSection?.id || null,
      action: {},
      created_at: now,
    })
    setInput('')
    setSending(true)

    try {
      const res = await fetch(`/api/the-signal/${briefingId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          targetSectionId: activeSection?.id || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Wren could not respond.')
        return
      }
      if (json.message) onMessageAppended(json.message)
      if (json.section) onSectionUpdated(json.section)
      if (json.deletedSectionId) onSectionDeleted(json.deletedSectionId)

      if (json.action === 'update_section') toast.success('Section updated.')
      if (json.action === 'add_section') toast.success('New section added.')
      if (json.action === 'delete_section') toast.success('Section removed.')
    } catch (err) {
      toast.error('Network error.')
    } finally {
      setSending(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-600" aria-hidden="true" />
        <span className="font-semibold text-sm text-gray-900 dark:text-white">Refine with Wren</span>
        {activeSection && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded-full">
            <Target className="w-3 h-3" aria-hidden="true" />
            {activeSection.title}
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Tell Wren what to sharpen, add, or cut. Click a section above to focus the conversation there.
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={disabled}
                  className="text-xs px-2.5 py-1 bg-gray-50 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-full border border-gray-200 hover:border-indigo-300 transition disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[85%] ${m.role === 'user' ? 'ml-auto' : ''}`}
          >
            <div
              className={`px-3 py-2 rounded-2xl text-sm ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="max-w-[85%]">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 text-sm text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={
              disabled
                ? 'Available once the briefing is ready…'
                : activeSection
                ? `Ask Wren to refine "${activeSection.title}"…`
                : 'Ask Wren to refine the briefing…'
            }
            rows={2}
            disabled={disabled || sending}
            className="flex-1 resize-none text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 disabled:opacity-60"
          />
          <button
            onClick={() => send()}
            disabled={disabled || sending || !input.trim()}
            className="self-end inline-flex items-center justify-center w-9 h-9 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
