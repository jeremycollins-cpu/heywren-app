'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight, ChevronLeft, X, CheckCircle2,
  BarChart3, Radio, ShieldCheck, Zap, Brain, Calendar,
  Edit, Briefcase, Trophy, Sparkles, MailWarning, Users
} from 'lucide-react'

interface WalkthroughStep {
  id: string
  title: string
  description: string
  details: string
  actionHint: string
  targetSelector: string // CSS selector for the element to highlight
  route?: string // navigate to this route when showing step
  icon: React.ReactNode
  position: 'right' | 'bottom' // tooltip position relative to target
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to HeyWren!',
    description: 'Your AI-powered follow-through engine that makes sure nothing falls through the cracks.',
    details: 'HeyWren connects to your Slack and email, automatically detects commitments you make in conversations, and nudges you before things go overdue. No manual entry needed — just work naturally and Wren handles the rest.',
    actionHint: 'Let\'s take a quick tour of the key features. This will only take about 2 minutes.',
    targetSelector: '[data-tour="logo"]',
    icon: <Sparkles className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'dashboard',
    title: 'Your Dashboard',
    description: 'This is your command center — everything at a glance.',
    details: 'Your dashboard shows your follow-through score (how well you\'re keeping promises), active commitments, overdue items, and anomaly alerts. The score updates automatically as Wren processes your messages. Think of it as your personal accountability scorecard.',
    actionHint: 'Your score starts building within minutes of connecting an integration.',
    targetSelector: '[data-tour="nav-dashboard"]',
    route: '/',
    icon: <BarChart3 className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'commitments',
    title: 'Commitments Tracker',
    description: 'Every promise, question, and follow-up — automatically captured.',
    details: 'When you say "I\'ll send that over by Friday" in Slack or "Let me follow up on this" in an email, Wren detects it and creates a tracked commitment. Each item shows who it\'s for, when it\'s due, the source message, and a priority score. You can mark items done, snooze them, or dismiss false positives.',
    actionHint: 'Commitments appear here automatically — no need to add them manually.',
    targetSelector: '[data-tour="nav-commitments"]',
    route: '/commitments',
    icon: <ShieldCheck className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'relationships',
    title: 'Relationship Intelligence',
    description: 'See your commitment history with every person you interact with.',
    details: 'Wren builds a profile of each person you make commitments to. See how many open items you have with your manager, direct reports, or cross-functional partners. This helps you prioritize who needs attention and ensures no relationship suffers from dropped balls.',
    actionHint: 'Relationships are built automatically from your commitments — the more you use Wren, the richer this gets.',
    targetSelector: '[data-tour="nav-relationships"]',
    route: '/relationships',
    icon: <Users className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'draft-queue',
    title: 'Draft Queue',
    description: 'AI-prepared responses ready for you to review and send.',
    details: 'When follow-ups are due, Wren drafts a response based on the original commitment context. Before meetings, it prepares talking points from your open commitments with each attendee. Review, edit, and send — or dismiss if you\'ve already handled it. This saves you hours of composing follow-up messages.',
    actionHint: 'Check your draft queue before meetings for prepared talking points and pending follow-ups.',
    targetSelector: '[data-tour="nav-draft-queue"]',
    route: '/draft-queue',
    icon: <Edit className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'missed-emails',
    title: 'Missed Emails',
    description: 'Important emails that need your attention but haven\'t gotten a reply.',
    details: 'Wren scans your inbox for emails that contain questions, requests, or action items directed at you that you haven\'t responded to. It ranks them by importance and age so you can quickly triage what needs a reply. No more "sorry for the late response" moments.',
    actionHint: 'Connect Outlook to start catching missed emails automatically.',
    targetSelector: '[data-tour="nav-missed-emails"]',
    route: '/missed-emails',
    icon: <MailWarning className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'coach',
    title: 'AI Coach',
    description: 'Personalized coaching based on your actual follow-through patterns.',
    details: 'Your AI coach analyzes how you handle commitments over time. It identifies patterns like "you tend to drop things on Fridays" or "commitments to external partners take 2x longer." Use these insights to build better habits. The coach improves as it learns your workflow.',
    actionHint: 'The coach gets smarter the longer you use Wren. Rate its suggestions to help it learn.',
    targetSelector: '[data-tour="nav-coach"]',
    route: '/coach',
    icon: <Brain className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'briefings',
    title: 'Meeting Briefings',
    description: 'Know exactly what to discuss before every meeting.',
    details: 'Before each meeting on your calendar, Wren compiles a briefing with: open commitments involving the attendees, recent messages with context, suggested talking points, and items you need to follow up on. Walk into every meeting prepared and never be caught off guard.',
    actionHint: 'Connect your calendar to get pre-meeting briefings automatically.',
    targetSelector: '[data-tour="nav-briefings"]',
    route: '/briefings',
    icon: <Briefcase className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'weekly',
    title: 'Weekly Review',
    description: 'A structured reflection on your week — what you completed, what slipped.',
    details: 'Every week, Wren compiles a review showing: commitments completed, items that went overdue, your follow-through score trend, and recommendations for the coming week. Spend 10 minutes reviewing this to stay on track and build self-awareness about your accountability habits.',
    actionHint: 'Set aside 10 minutes every Monday to review your weekly summary.',
    targetSelector: '[data-tour="nav-weekly"]',
    route: '/weekly',
    icon: <Calendar className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'integrations',
    title: 'Integrations',
    description: 'Connect your tools — the more you connect, the more Wren catches.',
    details: 'Wren currently supports Slack and Microsoft Outlook (email + calendar). Each integration uses secure OAuth — Wren gets read-only access and never sends messages on your behalf. You can disconnect at any time. Adding more integrations gives Wren a more complete picture of your commitments.',
    actionHint: 'Connect at least one integration to get started. We recommend starting with Slack or Outlook.',
    targetSelector: '[data-tour="nav-integrations"]',
    route: '/integrations',
    icon: <Radio className="w-6 h-6" />,
    position: 'right',
  },
  {
    id: 'complete',
    title: "You're Ready!",
    description: 'That\'s the tour! Wren is already working in the background.',
    details: 'Wren continuously monitors your connected tools and surfaces new commitments as they happen. Your follow-through score, draft queue, and briefings will populate automatically. The more you use Wren, the smarter it gets at understanding what matters to you.',
    actionHint: 'Head to Integrations to connect your first tool, or explore your dashboard while Wren gets to work.',
    targetSelector: '[data-tour="nav-dashboard"]',
    route: '/',
    icon: <CheckCircle2 className="w-6 h-6" />,
    position: 'right',
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
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (open) {
      setIsVisible(true)
      setCurrentStep(0)
      setShowDetails(false)
    }
  }, [open])

  const updateTargetPosition = useCallback(() => {
    const step = WALKTHROUGH_STEPS[currentStep]
    if (!step) return

    const target = document.querySelector(step.targetSelector)
    if (target) {
      const rect = target.getBoundingClientRect()
      setTargetRect(rect)
    } else {
      setTargetRect(null)
    }
  }, [currentStep])

  // Update target position when step changes
  useEffect(() => {
    if (!isVisible) return

    // Small delay to let DOM update after navigation
    const timer = setTimeout(updateTargetPosition, 150)
    return () => clearTimeout(timer)
  }, [currentStep, isVisible, updateTargetPosition])

  // Recalculate on resize/scroll
  useEffect(() => {
    if (!isVisible) return

    window.addEventListener('resize', updateTargetPosition)
    window.addEventListener('scroll', updateTargetPosition, true)
    return () => {
      window.removeEventListener('resize', updateTargetPosition)
      window.removeEventListener('scroll', updateTargetPosition, true)
    }
  }, [isVisible, updateTargetPosition])

  const step = WALKTHROUGH_STEPS[currentStep]

  const handleNext = () => {
    if (currentStep < WALKTHROUGH_STEPS.length - 1) {
      const nextStep = WALKTHROUGH_STEPS[currentStep + 1]
      setShowDetails(false)
      if (nextStep.route) {
        router.push(nextStep.route)
      }
      setCurrentStep(currentStep + 1)
    } else {
      completeWalkthrough()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      const prevStep = WALKTHROUGH_STEPS[currentStep - 1]
      setShowDetails(false)
      if (prevStep.route) {
        router.push(prevStep.route)
      }
      setCurrentStep(currentStep - 1)
    }
  }

  const completeWalkthrough = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setIsVisible(false)
    router.push('/')
    onClose()
  }

  const handleSkip = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, 'true')
    }
    setIsVisible(false)
    router.push('/')
    onClose()
  }

  if (!isVisible || !step) return null

  const isLastStep = currentStep === WALKTHROUGH_STEPS.length - 1

  // Calculate tooltip position based on target element
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      // Fallback: center of screen
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
    }

    if (step.position === 'right') {
      return {
        top: `${Math.max(80, Math.min(targetRect.top - 20, window.innerHeight - 500))}px`,
        left: `${targetRect.right + 20}px`,
      }
    }

    // bottom
    return {
      top: `${targetRect.bottom + 16}px`,
      left: `${Math.max(16, targetRect.left)}px`,
    }
  }

  // Spotlight circle around target
  const spotlightCx = targetRect ? targetRect.left + targetRect.width / 2 : -100
  const spotlightCy = targetRect ? targetRect.top + targetRect.height / 2 : -100
  const spotlightR = targetRect ? Math.max(targetRect.width, targetRect.height) / 2 + 12 : 0

  return (
    <>
      {/* Overlay with spotlight cutout */}
      <div className="fixed inset-0 z-[60]" onClick={handleSkip}>
        <svg className="w-full h-full">
          <defs>
            <mask id="walkthrough-mask">
              <rect width="100%" height="100%" fill="white" />
              {targetRect && (
                <rect
                  x={targetRect.left - 6}
                  y={targetRect.top - 6}
                  width={targetRect.width + 12}
                  height={targetRect.height + 12}
                  rx="8"
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.6)"
            mask="url(#walkthrough-mask)"
          />
        </svg>
      </div>

      {/* Highlight ring around target */}
      {targetRect && (
        <div
          className="fixed z-[61] pointer-events-none rounded-lg ring-2 ring-indigo-400 ring-offset-2"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* Tooltip Card */}
      <div
        ref={tooltipRef}
        className="fixed z-[62] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-[400px]"
        style={getTooltipStyle()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient */}
        <div
          className="rounded-t-2xl px-6 pt-5 pb-4"
          style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #ede9fe 100%)' }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-indigo-600 bg-white shadow-sm">
                {step.icon}
              </div>
              <div>
                <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  {currentStep + 1} of {WALKTHROUGH_STEPS.length}
                </p>
                <h3 className="text-lg font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
                  {step.title}
                </h3>
              </div>
            </div>
            <button
              onClick={handleSkip}
              className="p-1.5 hover:bg-white/60 rounded-lg transition"
              aria-label="Skip tour"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {step.description}
          </p>

          {/* Expandable details */}
          {!showDetails ? (
            <button
              onClick={() => setShowDetails(true)}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              Learn more
              <ChevronRight className="w-3 h-3" />
            </button>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed animate-in fade-in slide-in-from-top-2 duration-200">
              {step.details}
            </div>
          )}

          {/* Action Hint */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed flex items-start gap-2">
              <span className="text-amber-500 mt-0.5 flex-shrink-0">💡</span>
              {step.actionHint}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 space-y-3">
          {/* Progress bar */}
          <div className="flex gap-1">
            {WALKTHROUGH_STEPS.map((_, idx) => (
              <div
                key={idx}
                className={`h-1 rounded-full flex-1 transition-all ${
                  idx === currentStep
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600'
                    : idx < currentStep
                      ? 'bg-indigo-400'
                      : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1.5 px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition font-medium text-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
            <button
              onClick={handleSkip}
              className="px-3 py-2 text-gray-500 hover:text-gray-700 text-sm transition"
            >
              Skip tour
            </button>
            <button
              onClick={handleNext}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg transition font-semibold text-sm"
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
                  Go to Dashboard
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
