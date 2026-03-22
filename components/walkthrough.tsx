'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, X, CheckCircle2 } from 'lucide-react'

interface WalkthroughStep {
  id: string
  title: string
  description: string
  sidebarItemId: string
  icon: string
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'dashboard',
    title: 'Dashboard Overview',
    description: 'Get a bird\'s eye view of all your commitments, achievements, and progress at a glance.',
    sidebarItemId: 'dashboard',
    icon: '📊',
  },
  {
    id: 'commitments',
    title: 'Track Commitments',
    description: 'Create, track, and manage all your commitments in one place. Set reminders and follow up consistently.',
    sidebarItemId: 'commitments',
    icon: '✓',
  },
  {
    id: 'integrations',
    title: 'Connect Integrations',
    description: 'Link Slack, Outlook, and other tools to automatically detect and track commitments made across your platforms.',
    sidebarItemId: 'integrations',
    icon: '⚡',
  },
  {
    id: 'draft-queue',
    title: 'Draft Queue',
    description: 'Review and refine your draft messages before sending them. Perfect for crafting thoughtful responses.',
    sidebarItemId: 'draft-queue',
    icon: '✎',
  },
  {
    id: 'weekly',
    title: 'Weekly Review',
    description: 'Conduct your weekly review to reflect on progress, celebrate wins, and plan for the week ahead.',
    sidebarItemId: 'weekly',
    icon: '📅',
  },
  {
    id: 'achievements',
    title: 'Track Achievements',
    description: 'See all your completed commitments and milestones. Build momentum by celebrating your progress.',
    sidebarItemId: 'achievements',
    icon: '🏆',
  },
]

const STORAGE_KEY = 'heywren_walkthrough_completed'

interface WalkthroughProps {
  open: boolean
  onClose: () => void
}

export default function Walkthrough({ open, onClose }: WalkthroughProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setIsVisible(open)
  }, [open])

  const step = WALKTHROUGH_STEPS[currentStep]

  const handleNext = () => {
    if (currentStep < WALKTHROUGH_STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      completeWalkthrough()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const completeWalkthrough = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setIsVisible(false)
    onClose()
  }

  const handleSkip = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setIsVisible(false)
    onClose()
  }

  if (!isVisible) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={handleSkip}
      />

      {/* Spotlight overlay */}
      <div className="fixed inset-0 pointer-events-none z-40">
        <svg className="w-full h-full" style={{ filter: 'drop-shadow(0 0 0 999px rgba(0, 0, 0, 0.5))' }}>
          <defs>
            <mask id="spotlight-mask">
              <rect width="100%" height="100%" fill="white" />
              <circle
                id="spotlight-circle"
                r="60"
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="black"
            mask="url(#spotlight-mask)"
            opacity="0.5"
          />
        </svg>
      </div>

      {/* Tooltip Card */}
      <div
        className="fixed z-50 bg-white rounded-2xl shadow-2xl p-6 max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-300"
        style={{
          bottom: '40px',
          right: '40px',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>

        {/* Icon */}
        <div className="text-4xl mb-4">{step.icon}</div>

        {/* Content */}
        <h3 className="text-lg font-bold text-gray-900 mb-2" style={{ letterSpacing: '-0.025em' }}>
          {step.title}
        </h3>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          {step.description}
        </p>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 mb-6">
          {WALKTHROUGH_STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all ${
                idx === currentStep
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 w-6'
                  : idx < currentStep
                    ? 'bg-indigo-600 w-4'
                    : 'bg-gray-200 w-4'
              }`}
            />
          ))}
          <span className="text-xs text-gray-500 ml-2">
            {currentStep + 1} of {WALKTHROUGH_STEPS.length}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={handlePrev}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <button
            onClick={handleNext}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg transition font-medium text-sm"
            style={{
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
            }}
          >
            {currentStep === WALKTHROUGH_STEPS.length - 1 ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Complete
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </>
  )
}

// Helper hook to check if walkthrough should auto-start
export function useWalkthroughAutoStart() {
  const [shouldStart, setShouldStart] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const completed = localStorage.getItem(STORAGE_KEY)
      setShouldStart(!completed)
    }
  }, [])

  return shouldStart
}

// Helper to reset walkthrough
export function resetWalkthrough() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}

// Helper to mark as completed
export function completeWalkthrough() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, 'true')
  }
}
