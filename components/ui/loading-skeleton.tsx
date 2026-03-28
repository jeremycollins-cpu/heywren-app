'use client'

import { useState, useEffect } from 'react'

const loadingQuotes = [
  { text: "Scanning your conversations for hidden commitments...", subtext: "The best leaders never let a promise slip." },
  { text: "Analyzing your week like a chief of staff would...", subtext: "You're about to see the full picture." },
  { text: "Connecting the dots across your emails, chats, and meetings...", subtext: "Pattern recognition is a superpower." },
  { text: "Building your executive briefing...", subtext: "Your boss is going to wonder how you stay so organized." },
  { text: "Identifying what needs your attention most...", subtext: "Focus is the ultimate competitive advantage." },
  { text: "Tracking the commitments others have made to you...", subtext: "Accountability runs both ways." },
  { text: "Mapping your follow-through momentum...", subtext: "Consistency compounds. You're building trust daily." },
  { text: "Finding the signals in the noise...", subtext: "Not every email matters — but the ones that do really matter." },
  { text: "Preparing your personalized insights...", subtext: "Data-driven leaders outperform by 5x." },
  { text: "Reviewing your communication patterns...", subtext: "The fastest path to promotion? Never drop the ball." },
  { text: "Calculating your follow-through score...", subtext: "You're already ahead by caring about this." },
  { text: "Assembling your week's highlights...", subtext: "Every completed commitment is a reputation deposit." },
]

function useRotatingQuote() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * loadingQuotes.length))

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex(prev => (prev + 1) % loadingQuotes.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  return loadingQuotes[index]
}

interface LoadingSkeletonProps {
  variant?: 'dashboard' | 'list' | 'card'
}

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className ?? ''}`}
    />
  )
}

function StatCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3">
      <Bone className="h-3 w-20" />
      <Bone className="h-8 w-16" />
      <Bone className="h-2 w-full rounded-full" />
    </div>
  )
}

function NudgeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Bone className="h-4 w-48" />
        <Bone className="h-5 w-16 rounded-full" />
      </div>
      <Bone className="h-3 w-full" />
      <Bone className="h-3 w-3/4" />
      <div className="flex items-center gap-2 pt-1">
        <Bone className="h-8 w-20 rounded-lg" />
        <Bone className="h-8 w-20 rounded-lg" />
        <Bone className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  )
}

export function LoadingSkeleton({ variant = 'dashboard' }: LoadingSkeletonProps) {
  if (variant === 'card') {
    return <StatCardSkeleton />
  }

  if (variant === 'list') {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading content">
        <div className="flex items-center gap-3 py-4 justify-center">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
            <span className="text-sm text-white font-bold">W</span>
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Loading your data...</p>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <NudgeCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  const quote = useRotatingQuote()

  return (
    <div
      className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-4 sm:space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      {/* Branded loading hero */}
      <div className="flex flex-col items-center justify-center py-10 sm:py-16 space-y-5">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}>
            <span className="text-2xl text-white font-bold">W</span>
          </div>
          <div className="absolute -inset-2 rounded-2xl animate-ping opacity-20" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }} />
        </div>
        <div className="text-center space-y-2 max-w-md mx-auto px-4">
          <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white transition-all duration-500">
            {quote.text}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 transition-all duration-500">
            {quote.subtext}
          </p>
        </div>
        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>

      {/* Subtle skeleton below the quote */}
      <div className="space-y-3 opacity-40">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <NudgeCardSkeleton />
        <NudgeCardSkeleton />
      </div>
    </div>
  )
}
