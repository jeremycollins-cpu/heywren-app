'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, X, CheckCircle2, LayoutDashboard, Radio, ShieldCheck, Zap, Sparkles } from 'lucide-react'

interface WalkthroughStep {
  id: string
  title: string
  description: string
  actionHint: string
  sidebarItemId: string
  icon: React.ReactNode
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'dashboard',
    title: 'Your Command Center',
    description: 'Your dashboard shows your follow-through score, active commitments, and anomalies at a glance. Everything you need to stay on top of your promises lives here.',
    actionHint: 'Your score starts building as Wren scans your messages.',
    sidebarItemId: 'dashboard',
    icon: <LayoutDashboard className="w-6 h-6" />,
  },
  {
    id: 'integrations',
    title: 'Wren is Watching',
    description: 'Wren connects to your Slack and email to automatically detect commitments. No copy-pasting, no manual entry — just connect and go.',
    actionHint: 'Your first results will appear within minutes of connecting.',
    sidebarItemId: 'integrations',
    icon: <Radio className="w-6 h-6" />,
  },
  {
    id: 'commitments',
    title: 'Never Drop the Ball',
    description: 'Every promise you make, question you receive, and follow-up you owe gets tracked automatically. Missed emails and forgotten threads surface here so nothing slips through the cracks.',
    actionHint: 'Your first commitments will appear here once Wren scans your messages.',
    sidebarItemId: 'commitments',
    icon: <ShieldCheck className="w-6 h-6" />,
  },
  {
    id: 'draft-queue',
    title: 'Stay Ahead',
    description: 'Before each meeting, Wren prepares talking points from your open commitments. When follow-ups are due, draft responses are ready to review and send.',
    actionHint: 'Check your draft queue before your next meeting for prepared talking points.',
    sidebarItemId: 'draft-queue',
    icon: <Zap className="w-6 h-6" />,
  },
  {
    id: 'complete',
    title: "You're All Set!",
    description: 'Wren gets smarter over time as it learns your communication patterns. Rate alerts as helpful or not helpful to train your personal AI follow-through assistant.',
    actionHint: 'The more you use Wren, the better it gets at knowing what matters to you.',
    sidebarItemId: 'dashboard',
    icon: <Sparkles className="w-6 h-6" />,
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

  const isLastStep = currentStep === WALKTHROUGH_STEPS.length - 1

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
        className="fixed z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-300"
        style={{
          bottom: '40px',
          right: '40px',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
          aria-label="Skip walkthrough"
        >
          <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>

        {/* Icon */}
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-indigo-600 dark:text-indigo-400" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #ede9fe 100%)' }}>
          {step.icon}
        </div>

        {/* Content */}
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2" style={{ letterSpacing: '-0.025em' }}>
          {step.title}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 leading-relaxed">
          {step.description}
        </p>

        {/* Action Hint */}
        <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-lg px-3 py-2 mb-6">
          <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
            {step.actionHint}
          </p>
        </div>

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
                    : 'bg-gray-200 dark:bg-gray-700 w-4'
              }`}
            />
          ))}
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            {currentStep + 1} of {WALKTHROUGH_STEPS.length}
          </span>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={handlePrev}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition font-medium text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          )}
          <button
            onClick={handleNext}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg transition font-medium text-sm"
            style={{
              background: isLastStep
                ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              boxShadow: isLastStep
                ? '0 4px 16px rgba(22, 163, 74, 0.3)'
                : '0 4px 16px rgba(79, 70, 229, 0.2)',
            }}
          >
            {isLastStep ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Let&apos;s Go!
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
export function completeWalkthroughStorage() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, 'true')
  }
}
