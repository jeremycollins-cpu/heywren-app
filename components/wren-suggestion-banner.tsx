'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'

interface WrenSuggestion {
  suggestion: string
  action_label?: string
  action_type?: string
}

interface WrenSuggestionBannerProps {
  page: string
}

export function WrenSuggestionBanner({ page }: WrenSuggestionBannerProps) {
  const [suggestion, setSuggestion] = useState<WrenSuggestion | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check session dismissal
    const key = `wren_suggestion_${page}`
    if (sessionStorage.getItem(key)) {
      setDismissed(true)
      return
    }

    fetch(`/api/wren-suggestions?page=${page}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.suggestion) setSuggestion(data)
      })
      .catch(() => {})
  }, [page])

  if (dismissed || !suggestion) return null

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-6 h-6 rounded-md bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center flex-shrink-0">
        <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
      </div>
      <p className="flex-1 text-sm text-indigo-800 dark:text-indigo-200">
        <span className="font-semibold">Wren:</span> {suggestion.suggestion}
      </p>
      <button
        onClick={() => {
          setDismissed(true)
          sessionStorage.setItem(`wren_suggestion_${page}`, 'true')
        }}
        className="p-1 text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 rounded flex-shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
