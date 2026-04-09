'use client'

import { useState, useEffect, useCallback } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import {
  AtSign, Mail, MessageSquare, Mic,
  CheckCircle2, ExternalLink, Clock, Filter,
  ChevronDown, Loader2, Inbox, ListChecks,
} from 'lucide-react'
import { useTodo } from '@/lib/contexts/todo-context'

interface WrenMention {
  id: string
  channel: 'slack' | 'email' | 'meeting'
  source_title: string
  source_snippet: string | null
  source_ref: string | null
  source_url: string | null
  participant_name: string | null
  commitments_extracted: number
  created_at: string
}

const channelConfig = {
  slack: {
    icon: MessageSquare,
    label: 'Slack',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    dot: 'bg-purple-500',
  },
  email: {
    icon: Mail,
    label: 'Email BCC',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    dot: 'bg-blue-500',
  },
  meeting: {
    icon: Mic,
    label: 'Meeting',
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    border: 'border-teal-200 dark:border-teal-800',
    dot: 'bg-teal-500',
  },
}

type ChannelFilter = 'all' | 'slack' | 'email' | 'meeting'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function MentionCard({ mention, onAddTodo }: { mention: WrenMention; onAddTodo: (title: string) => void }) {
  const cfg = channelConfig[mention.channel]
  const Icon = cfg.icon

  return (
    <div className={`border ${cfg.border} rounded-xl p-4 bg-white dark:bg-surface-dark-secondary hover:shadow-sm transition`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`flex items-center justify-center w-9 h-9 rounded-lg ${cfg.bg} flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${cfg.color}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${cfg.color} ${cfg.bg}`}>
                {cfg.label}
              </span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {formatDate(mention.created_at)}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-snug truncate">
              {mention.source_title}
            </h3>
            {mention.source_snippet && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                &ldquo;{mention.source_snippet}&rdquo;
              </p>
            )}
            <div className="flex items-center gap-3 mt-2">
              {mention.participant_name && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="font-medium">From:</span> {mention.participant_name}
                </span>
              )}
              {mention.commitments_extracted > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3 h-3" />
                  {mention.commitments_extracted} commitment{mention.commitments_extracted !== 1 ? 's' : ''} tracked
                </span>
              )}
              {mention.commitments_extracted === 0 && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  No commitments detected
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onAddTodo(mention.source_snippet || mention.source_title)}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:text-emerald-300 dark:hover:bg-emerald-900/30 transition"
            title="Add to To-Dos"
          >
            <ListChecks className="w-3.5 h-3.5" />
          </button>
          {mention.source_url && (
            <a
              href={mention.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition"
              title="Open original"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export default function WrenMentionsPage() {
  const { addTodoFromPage } = useTodo()
  const [mentions, setMentions] = useState<WrenMention[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [filter, setFilter] = useState<ChannelFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)

  const fetchMentions = useCallback(async (pageNum: number, channel: ChannelFilter, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)

    try {
      const params = new URLSearchParams({ page: String(pageNum) })
      if (channel !== 'all') params.set('channel', channel)
      const res = await fetch(`/api/wren-mentions?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setMentions(prev => append ? [...prev, ...data.mentions] : data.mentions)
      setTotal(data.total)
      setHasMore(data.hasMore)
      setPage(pageNum)
    } catch (err) {
      console.error('Failed to fetch wren mentions:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    fetchMentions(1, filter)
  }, [filter, fetchMentions])

  const channelCounts = mentions.reduce((acc, m) => {
    acc[m.channel] = (acc[m.channel] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageHeader
        title="Wren Mentions"
        description="Every time you tagged @HeyWren in Slack, said &ldquo;Hey Wren&rdquo; in a meeting, or BCC&rsquo;d wren@heywren.ai on an email."
      />

      {/* Stats bar */}
      <div className="flex items-center gap-4 mt-4 mb-5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
          <AtSign className="w-4 h-4 text-indigo-500" />
          {total} mention{total !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {Object.entries(channelConfig).map(([key, cfg]) => {
            const count = channelCounts[key] || 0
            if (count === 0 && filter === 'all') return null
            return (
              <span key={key} className={`inline-flex items-center gap-1 ${cfg.color}`}>
                <cfg.icon className="w-3 h-3" />
                {count}
              </span>
            )
          })}
        </div>

        {/* Filter */}
        <div className="relative ml-auto">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            <Filter className="w-3 h-3" />
            {filter === 'all' ? 'All channels' : channelConfig[filter].label}
            <ChevronDown className="w-3 h-3" />
          </button>
          {filterOpen && (
            <div className="absolute right-0 mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 py-1">
              {([
                { key: 'all' as const, label: 'All channels' },
                { key: 'slack' as const, label: 'Slack' },
                { key: 'email' as const, label: 'Email BCC' },
                { key: 'meeting' as const, label: 'Meetings' },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setFilter(opt.key); setFilterOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 ${filter === opt.key ? 'font-semibold text-indigo-600 dark:text-indigo-400' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* BCC hint */}
      <div className="mb-5 px-4 py-3 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-900/20 dark:via-indigo-900/20 dark:to-purple-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl">
        <p className="text-xs text-gray-700 dark:text-gray-300">
          <span className="font-semibold">Tip:</span> BCC{' '}
          <code className="px-1 py-0.5 bg-white dark:bg-gray-800 rounded text-indigo-600 dark:text-indigo-400 font-mono text-[11px]">
            wren@heywren.ai
          </code>{' '}
          on any email and Wren will track commitments from that conversation — just like tagging @HeyWren in Slack.
        </p>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : mentions.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <Inbox className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No mentions yet</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            Tag <span className="font-semibold">@HeyWren</span> in Slack, say <span className="font-semibold">&ldquo;Hey Wren&rdquo;</span> in a meeting,
            or BCC <span className="font-semibold">wren@heywren.ai</span> on an email to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mentions.map(mention => (
            <MentionCard key={mention.id} mention={mention} onAddTodo={addTodoFromPage} />
          ))}

          {hasMore && (
            <button
              onClick={() => fetchMentions(page + 1, filter, true)}
              disabled={loadingMore}
              className="w-full py-2.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition disabled:opacity-50"
            >
              {loadingMore ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
              ) : (
                'Load more'
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
