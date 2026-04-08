'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

interface WrenInsight {
  insight: string
  action_label: string
  action_href: string
  mood: 'positive' | 'attention' | 'urgent'
}

const moodStyles = {
  positive: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: CheckCircle2,
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    accent: 'bg-emerald-600 hover:bg-emerald-700',
  },
  attention: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    icon: Sparkles,
    iconColor: 'text-amber-600 dark:text-amber-400',
    accent: 'bg-amber-600 hover:bg-amber-700',
  },
  urgent: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    icon: AlertTriangle,
    iconColor: 'text-red-600 dark:text-red-400',
    accent: 'bg-red-600 hover:bg-red-700',
  },
}

export function WrenInsightCard() {
  const [insight, setInsight] = useState<WrenInsight | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if dismissed today
    const dismissedAt = localStorage.getItem('wren_insight_dismissed')
    if (dismissedAt) {
      const dismissDate = new Date(dismissedAt).toDateString()
      if (dismissDate === new Date().toDateString()) {
        setDismissed(true)
        setLoading(false)
        return
      }
    }

    fetch('/api/wren-insight')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.error) setInsight(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-3 animate-pulse">
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin flex-shrink-0" />
        <span className="text-sm text-indigo-600 dark:text-indigo-400">Wren is thinking...</span>
      </div>
    )
  }

  if (dismissed || !insight) return null

  const style = moodStyles[insight.mood] || moodStyles.attention
  const MoodIcon = style.icon

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-4 flex items-start gap-3`}>
      <div className={`w-8 h-8 rounded-lg bg-white/80 dark:bg-white/10 flex items-center justify-center flex-shrink-0`}>
        <MoodIcon className={`w-4 h-4 ${style.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 dark:text-gray-200">
          <span className="font-semibold">Wren:</span> {insight.insight}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <Link
            href={insight.action_href}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-lg ${style.accent} transition`}
          >
            {insight.action_label}
            <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            onClick={() => {
              setDismissed(true)
              localStorage.setItem('wren_insight_dismissed', new Date().toISOString())
            }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            Dismiss for today
          </button>
        </div>
      </div>
    </div>
  )
}
