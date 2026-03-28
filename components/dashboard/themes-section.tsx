'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, TrendingUp, Minus, AlertCircle,
  Mail, Calendar, MessageSquare, CheckCircle2,
  RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'

interface WorkTheme {
  title: string
  summary: string
  impact: string
  sources: { emails: number; meetings: number; chats: number; commitments: number }
  sentiment: 'momentum' | 'steady' | 'needs_attention'
  keyPeople: string[]
  highlights: string[]
}

interface ThemesData {
  themes: WorkTheme[]
  headline: string
  periodLabel: string
  generatedAt: string
  insufficient?: boolean
}

const sentimentConfig = {
  momentum: {
    icon: TrendingUp,
    label: 'Momentum',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    bar: 'bg-emerald-500',
  },
  steady: {
    icon: Minus,
    label: 'On Track',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    bar: 'bg-blue-500',
  },
  needs_attention: {
    icon: AlertCircle,
    label: 'Needs Attention',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    bar: 'bg-amber-500',
  },
}

function SourcePills({ sources }: { sources: WorkTheme['sources'] }) {
  const items = [
    { count: sources.emails, icon: Mail, label: 'emails', color: 'text-blue-600 dark:text-blue-400' },
    { count: sources.meetings, icon: Calendar, label: 'meetings', color: 'text-teal-600 dark:text-teal-400' },
    { count: sources.chats, icon: MessageSquare, label: 'chats', color: 'text-purple-600 dark:text-purple-400' },
    { count: sources.commitments, icon: CheckCircle2, label: 'commitments', color: 'text-indigo-600 dark:text-indigo-400' },
  ].filter(i => i.count > 0)

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(item => (
        <span key={item.label} className={`inline-flex items-center gap-1 text-xs ${item.color}`}>
          <item.icon className="w-3 h-3" />
          {item.count} {item.label}
        </span>
      ))}
    </div>
  )
}

function ThemeCard({ theme, index }: { theme: WorkTheme; index: number }) {
  const [expanded, setExpanded] = useState(index === 0)
  const config = sentimentConfig[theme.sentiment]
  const SentimentIcon = config.icon

  return (
    <div className={`border ${config.border} rounded-xl overflow-hidden transition-all`}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left px-5 py-4 flex items-center justify-between gap-4 ${config.bg} hover:opacity-90 transition`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${config.bg} border ${config.border}`}>
            <SentimentIcon className={`w-4 h-4 ${config.color}`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{theme.title}</h3>
            <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {theme.keyPeople.length > 0 && (
            <div className="hidden sm:flex -space-x-1">
              {theme.keyPeople.slice(0, 3).map((name, i) => (
                <span
                  key={i}
                  className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white dark:bg-gray-700 border-2 border-white dark:border-gray-800 text-[10px] font-bold text-gray-600 dark:text-gray-300"
                  title={name}
                >
                  {name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </span>
              ))}
              {theme.keyPeople.length > 3 && (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-600 border-2 border-white dark:border-gray-800 text-[10px] font-medium text-gray-500 dark:text-gray-300">
                  +{theme.keyPeople.length - 3}
                </span>
              )}
            </div>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 py-4 bg-white dark:bg-surface-dark-secondary space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{theme.summary}</p>

          {/* Highlights */}
          {theme.highlights.length > 0 && (
            <div className="space-y-1.5">
              {theme.highlights.map((h, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">{h}</span>
                </div>
              ))}
            </div>
          )}

          {/* Impact */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">Why it matters</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{theme.impact}</p>
          </div>

          {/* Footer: people + sources */}
          <div className="flex items-center justify-between pt-1">
            {theme.keyPeople.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium">With:</span>
                {theme.keyPeople.join(', ')}
              </div>
            )}
            <SourcePills sources={theme.sources} />
          </div>
        </div>
      )}
    </div>
  )
}

export function ThemesSection() {
  const [data, setData] = useState<ThemesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchThemes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/themes')
      if (!res.ok) throw new Error('Failed to generate themes')
      const result = await res.json()
      setData(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchThemes()
  }, [fetchThemes])

  // Loading state
  if (loading && !data) {
    return (
      <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)' }}>
            <Sparkles className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Your Week at a Glance</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Analyzing your activity...</p>
          </div>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
          <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
          <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        </div>
      </section>
    )
  }

  // Insufficient data — show helpful message
  if (data?.insufficient) {
    return (
      <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)' }}>
            <Sparkles className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Your Week at a Glance</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">AI-powered executive summary</p>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Not enough activity data yet to generate themes. As your emails, meetings, and messages flow in, Wren will surface the patterns that matter most.
        </p>
      </section>
    )
  }

  // Error state — show retry option
  if (error || !data || data.themes.length === 0) {
    return (
      <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)' }}>
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Your Week at a Glance</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{error ? 'Something went wrong' : 'Generating your executive summary...'}</p>
            </div>
          </div>
          <button
            onClick={fetchThemes}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
      </section>
    )
  }

  const totalSources = data.themes.reduce((acc, t) => ({
    emails: acc.emails + t.sources.emails,
    meetings: acc.meetings + t.sources.meetings,
    chats: acc.chats + t.sources.chats,
    commitments: acc.commitments + t.sources.commitments,
  }), { emails: 0, meetings: 0, chats: 0, commitments: 0 })

  const totalDataPoints = totalSources.emails + totalSources.meetings + totalSources.chats + totalSources.commitments

  return (
    <section className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)' }}>
              <Sparkles className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Your Week at a Glance</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">{data.periodLabel} &middot; {totalDataPoints} data points analyzed</p>
            </div>
          </div>
          <button
            onClick={fetchThemes}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Updating...' : 'Refresh'}
          </button>
        </div>

        {/* Headline */}
        <div className="mt-4 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-violet-50 dark:from-indigo-900/20 dark:via-purple-900/20 dark:to-violet-900/20 border border-indigo-100 dark:border-indigo-800/50">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-relaxed">
            {data.headline}
          </p>
        </div>
      </div>

      {/* Theme Cards */}
      <div className="px-5 pb-5 space-y-2">
        {data.themes.map((theme, i) => (
          <ThemeCard key={i} theme={theme} index={i} />
        ))}
      </div>
    </section>
  )
}
