'use client'

import { useMemo } from 'react'

const LOADING_QUOTES = [
  "Scanning your commitments...",
  "Great follow-through starts with awareness.",
  "Rounding up what needs your attention...",
  "The best professionals never let things slip.",
  "Checking in so you don't have to remember.",
  "Your future self will thank you for this.",
  "Good habits compound. So does follow-through.",
  "On it — nothing falls through the cracks.",
  "Organizing your open loops...",
  "Reliability is a superpower.",
  "Small follow-ups, big trust.",
  "Gathering your action items...",
  "Consistency beats intensity.",
  "Prepping your productivity dashboard...",
  "The Wren never forgets. Neither will you.",
]

function getRandomQuote() {
  return LOADING_QUOTES[Math.floor(Math.random() * LOADING_QUOTES.length)]
}

// Animated Wren bird icon for loading states
function LoadingWrenIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 76 76"
      fill="none"
      className="animate-pulse"
    >
      <g transform="translate(0, 4)">
        <ellipse cx="38" cy="42" rx="18" ry="14" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="50" cy="30" r="9" stroke="#4f46e5" strokeWidth="2.2" fill="none" />
        <circle cx="53" cy="28" r="2" fill="#4f46e5" />
        <path d="M 58 29 L 66 26 L 59 33" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M 28 39 C 34 33, 44 31, 50 35" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M 20 38 C 14 32, 12 22, 15 15" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M 36 56 L 34 65 M 44 55 L 42 64" stroke="#4f46e5" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  )
}

interface LoadingSkeletonProps {
  variant?: 'dashboard' | 'list' | 'card'
}

export function LoadingSkeleton({ variant = 'dashboard' }: LoadingSkeletonProps) {
  const quote = useMemo(() => getRandomQuote(), [])

  return (
    <div
      className="flex flex-col items-center justify-center py-20 px-8 animate-fade-in"
      role="status"
      aria-busy="true"
      aria-label="Loading content"
    >
      <LoadingWrenIcon size={variant === 'card' ? 36 : 48} />
      <p className="mt-4 text-sm font-medium text-brand-900/70 dark:text-brand-300/70 text-center max-w-xs">
        {quote}
      </p>
      <div className="mt-6 flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
