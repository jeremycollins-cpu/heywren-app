'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import {
  X, ChevronRight, Lightbulb, BarChart3, ShieldCheck, Users, Brain,
  Calendar, Edit, Briefcase, Trophy, Zap, MailWarning, FileText, Hand,
  type LucideIcon
} from 'lucide-react'

interface FeatureGuide {
  title: string
  subtitle: string
  icon: LucideIcon
  steps: {
    title: string
    description: string
  }[]
  proTip: string
}

const PAGE_GUIDES: Record<string, FeatureGuide> = {
  '/': {
    title: 'Your Dashboard',
    subtitle: 'Here\'s how to read your command center',
    icon: BarChart3,
    steps: [
      {
        title: 'Follow-Through Score',
        description: 'This percentage reflects how well you\'re keeping your promises. It factors in response time, completion rate, and overdue items. Above 80% means you\'re doing great.',
      },
      {
        title: 'Active & Overdue Items',
        description: 'Active items are commitments Wren has detected that are still open. Overdue items are past their expected completion time. Focus on these first.',
      },
      {
        title: 'Anomaly Alerts',
        description: 'Wren flags unusual patterns — like a spike in overdue items, or commitments piling up from one source. These are early warnings before things slip.',
      },
      {
        title: 'Nudge Cards',
        description: 'At the bottom, you\'ll see items that need follow-through. Each card shows the original commitment, who it\'s for, and suggested actions you can take right now.',
      },
    ],
    proTip: 'Check your dashboard first thing each morning. A quick 2-minute scan sets you up for the day.',
  },
  '/commitments': {
    title: 'Commitments',
    subtitle: 'Everything you\'ve promised, tracked automatically',
    icon: ShieldCheck,
    steps: [
      {
        title: 'How Commitments Are Detected',
        description: 'Wren uses AI to scan your Slack messages and emails for language like "I\'ll handle this", "let me follow up", or "I can get that done by Friday." No manual entry needed.',
      },
      {
        title: 'Priority Scoring',
        description: 'Each commitment gets a priority score (0-100) based on urgency, the person involved, and how long it\'s been open. Higher scores need attention first.',
      },
      {
        title: 'Taking Action',
        description: 'Click "Done" when you\'ve completed a commitment, "Snooze" to push it to later, or "Dismiss" if Wren caught something that isn\'t actually a commitment.',
      },
      {
        title: 'Filtering & Search',
        description: 'Use filters to see commitments by status (open, completed, overdue), source (Slack, email), or person. This helps you focus on what matters now.',
      },
    ],
    proTip: 'Dismissing false positives helps Wren learn. Over time, it gets much better at detecting real commitments.',
  },
  '/relationships': {
    title: 'Relationships',
    subtitle: 'Your commitment history with every contact',
    icon: Users,
    steps: [
      {
        title: 'People You Work With',
        description: 'Wren identifies everyone you make commitments to and tracks your follow-through rate per person. This shows you where your strongest and weakest relationships are.',
      },
      {
        title: 'Commitment History',
        description: 'Click on any person to see your full history — completed items, open items, and how quickly you typically respond to them.',
      },
      {
        title: 'Prioritizing Relationships',
        description: 'If you see a low follow-through rate with your manager or a key client, that\'s a signal to prioritize those commitments.',
      },
    ],
    proTip: 'Pay special attention to relationships where your follow-through is below 70% — those are at risk.',
  },
  '/coach': {
    title: 'AI Coach',
    subtitle: 'Personalized insights to improve your follow-through',
    icon: Brain,
    steps: [
      {
        title: 'Pattern Analysis',
        description: 'Your coach reviews your commitment data to spot trends — times of week you struggle, types of commitments you drop, and people you\'re most responsive to.',
      },
      {
        title: 'Actionable Recommendations',
        description: 'Each insight comes with a concrete suggestion. For example: "You tend to over-commit on Mondays — try blocking 2 hours for existing work."',
      },
      {
        title: 'Improving Over Time',
        description: 'The coach learns from your behavior changes. As you improve, it adjusts its recommendations to focus on your next growth area.',
      },
    ],
    proTip: 'Pick one recommendation each week and focus on it. Small changes compound into big improvements.',
  },
  '/weekly': {
    title: 'Weekly Review',
    subtitle: 'Reflect, learn, and plan ahead',
    icon: Calendar,
    steps: [
      {
        title: 'Week in Review',
        description: 'See how many commitments you completed vs. how many went overdue. Your follow-through score trend shows whether you\'re improving week over week.',
      },
      {
        title: 'Wins & Misses',
        description: 'Celebrate what you completed and examine what slipped. Understanding why things slipped is the key to preventing it next time.',
      },
      {
        title: 'Next Week Planning',
        description: 'See what\'s already on your plate for next week. This helps you make realistic new commitments without overloading yourself.',
      },
    ],
    proTip: 'Block 15 minutes every Monday morning for your weekly review. Consistency is what builds the habit.',
  },
  '/draft-queue': {
    title: 'Draft Queue',
    subtitle: 'AI-prepared responses, ready when you are',
    icon: Edit,
    steps: [
      {
        title: 'How Drafts Are Generated',
        description: 'When a commitment is due or a follow-up is needed, Wren drafts a message based on the original context. It pulls in relevant details so you don\'t have to dig through old threads.',
      },
      {
        title: 'Review & Edit',
        description: 'Every draft is just a starting point. Review it, make it your own, then send. You can also dismiss drafts you don\'t need.',
      },
      {
        title: 'Pre-Meeting Prep',
        description: 'Before meetings, Wren prepares talking points based on open commitments with attendees. Check your queue 10 minutes before each meeting.',
      },
    ],
    proTip: 'Process your draft queue in batches — it\'s much more efficient than writing follow-ups one at a time throughout the day.',
  },
  '/missed-emails': {
    title: 'Missed Emails',
    subtitle: 'Important emails waiting for your reply',
    icon: MailWarning,
    steps: [
      {
        title: 'What Gets Flagged',
        description: 'Wren identifies emails containing questions directed at you, action item requests, or time-sensitive matters that haven\'t received a reply.',
      },
      {
        title: 'Priority Ranking',
        description: 'Emails are ranked by importance (sender, content urgency) and age. The oldest high-priority items appear first.',
      },
      {
        title: 'Taking Action',
        description: 'Click through to reply directly, or mark as "handled" if you responded through another channel (like Slack or in person).',
      },
    ],
    proTip: 'Check missed emails once a day. Responding to a 3-day-old email is much better than never responding at all.',
  },
  '/briefings': {
    title: 'Meeting Briefings',
    subtitle: 'Walk into every meeting fully prepared',
    icon: Briefcase,
    steps: [
      {
        title: 'Pre-Meeting Intelligence',
        description: 'Before each calendar event, Wren compiles open commitments involving the meeting attendees, recent relevant messages, and suggested talking points.',
      },
      {
        title: 'Action Items from Last Meeting',
        description: 'If you had previous meetings with the same people, Wren surfaces what was promised and whether those items are complete.',
      },
      {
        title: 'After the Meeting',
        description: 'New commitments made during the meeting will be detected from follow-up Slack messages and emails, automatically closing the loop.',
      },
    ],
    proTip: 'Open your briefing 5 minutes before each meeting. It only takes a quick skim to feel prepared.',
  },
  '/playbooks': {
    title: 'Playbooks',
    subtitle: 'Reusable workflows for repeating situations',
    icon: FileText,
    steps: [
      {
        title: 'What Are Playbooks',
        description: 'Playbooks are templates for recurring processes — like client onboarding, sprint planning follow-ups, or quarterly review prep.',
      },
      {
        title: 'Creating a Playbook',
        description: 'When you notice a pattern that works, save it as a playbook. Define the steps, timing, and who\'s involved.',
      },
      {
        title: 'Sharing with Your Team',
        description: 'Playbooks can be shared across your team so everyone follows the same proven process.',
      },
    ],
    proTip: 'Start with one playbook for your most common workflow. Perfect it, then expand to others.',
  },
  '/handoff': {
    title: 'Handoff',
    subtitle: 'Pass work to others without dropping the ball',
    icon: Hand,
    steps: [
      {
        title: 'Creating a Handoff',
        description: 'When you need someone else to take over a commitment, create a handoff with full context — what\'s been done, what\'s left, and when it\'s due.',
      },
      {
        title: 'PTO Handoffs',
        description: 'Going on vacation? Wren helps you bundle your open commitments into a clear handoff package so nothing gets lost while you\'re away.',
      },
      {
        title: 'Tracking Handoffs',
        description: 'Monitor the status of items you\'ve handed off. Wren will alert you if something seems stalled.',
      },
    ],
    proTip: 'Always include the "why" in your handoffs — context helps the receiver make good decisions.',
  },
  '/achievements': {
    title: 'Achievements',
    subtitle: 'Celebrate your follow-through wins',
    icon: Trophy,
    steps: [
      {
        title: 'Milestone Tracking',
        description: 'Wren tracks milestones like streaks (consecutive days with no overdue items), completion counts, and response time improvements.',
      },
      {
        title: 'Consistency Matters',
        description: 'The most impactful achievement isn\'t a single big win — it\'s maintaining a high follow-through rate week after week.',
      },
    ],
    proTip: 'Share your achievements with your team to build a culture of accountability.',
  },
  '/integrations': {
    title: 'Integrations',
    subtitle: 'Connect your tools for complete coverage',
    icon: Zap,
    steps: [
      {
        title: 'Available Integrations',
        description: 'Connect Slack for messaging-based commitments and Microsoft Outlook for email and calendar. More integrations are coming soon.',
      },
      {
        title: 'Security & Privacy',
        description: 'All integrations use OAuth with minimal read-only permissions. Wren never sends messages on your behalf. You can disconnect at any time.',
      },
      {
        title: 'Better Together',
        description: 'Connecting both Slack and Outlook gives Wren a complete picture. Commitments made via email and followed up on in Slack (or vice versa) will be linked together.',
      },
    ],
    proTip: 'Start with the tool where you make the most promises — usually Slack for teams, Outlook for client-facing roles.',
  },
}

const STORAGE_KEY = 'heywren_discovered_pages'

function getDiscoveredPages(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? new Set(JSON.parse(stored)) : new Set()
  } catch {
    return new Set()
  }
}

function markPageDiscovered(path: string) {
  if (typeof window === 'undefined') return
  const discovered = getDiscoveredPages()
  discovered.add(path)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...discovered]))
}

export default function FeatureDiscovery() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [guide, setGuide] = useState<FeatureGuide | null>(null)
  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [guidePath, setGuidePath] = useState<string | null>(null)

  useEffect(() => {
    // Don't show if walkthrough is still active
    const walkthroughCompleted = localStorage.getItem('heywren_walkthrough_completed')
    if (!walkthroughCompleted) return

    const basePath = pathname === '/' ? '/' : '/' + pathname.split('/')[1]
    const pageGuide = PAGE_GUIDES[basePath]
    if (!pageGuide) return

    const discovered = getDiscoveredPages()
    if (discovered.has(basePath)) return

    // Small delay to not compete with page load
    const timer = setTimeout(() => {
      setGuide(pageGuide)
      setGuidePath(basePath)
      setCurrentStepIdx(0)
      setVisible(true)
    }, 800)

    return () => clearTimeout(timer)
  }, [pathname])

  const handleDismiss = useCallback(() => {
    if (guidePath) {
      markPageDiscovered(guidePath)
    }
    setVisible(false)
  }, [guidePath])

  const handleNext = () => {
    if (!guide) return
    if (currentStepIdx < guide.steps.length - 1) {
      setCurrentStepIdx(currentStepIdx + 1)
    } else {
      handleDismiss()
    }
  }

  const handlePrev = () => {
    if (currentStepIdx > 0) {
      setCurrentStepIdx(currentStepIdx - 1)
    }
  }

  if (!visible || !guide) return null

  const step = guide.steps[currentStepIdx]
  const isLastStep = currentStepIdx === guide.steps.length - 1
  const Icon = guide.icon

  return (
    <>
      {/* Subtle backdrop - click to dismiss */}
      <div
        className="fixed inset-0 bg-black/20 z-50 animate-in fade-in duration-200"
        onClick={handleDismiss}
      />

      {/* Discovery card - centered modal */}
      <div
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="rounded-t-2xl px-6 pt-6 pb-4"
          style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 50%, #ede9fe 100%)' }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-md"
                style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
                  {guide.title}
                </h3>
                <p className="text-sm text-gray-600">{guide.subtitle}</p>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1.5 hover:bg-white/60 rounded-lg transition"
              aria-label="Dismiss guide"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Step navigation pills */}
        <div className="px-6 pt-4 flex gap-2 flex-wrap">
          {guide.steps.map((s, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStepIdx(idx)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                idx === currentStepIdx
                  ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200'
                  : idx < currentStepIdx
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {idx < currentStepIdx ? '✓ ' : ''}{s.title}
            </button>
          ))}
        </div>

        {/* Current step content */}
        <div className="px-6 py-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">
              {step.title}
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {step.description}
            </p>
          </div>
        </div>

        {/* Pro Tip - only on last step */}
        {isLastStep && (
          <div className="px-6 pb-2">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span><strong>Pro tip:</strong> {guide.proTip}</span>
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {currentStepIdx + 1} of {guide.steps.length}
          </p>
          <div className="flex gap-2">
            {currentStepIdx > 0 && (
              <button
                onClick={handlePrev}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition font-medium"
              >
                Back
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition"
            >
              Dismiss
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-1.5 text-white rounded-lg transition font-semibold text-sm"
              style={{
                background: isLastStep
                  ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
                  : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              }}
            >
              {isLastStep ? 'Got it!' : (
                <>
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// Helper to reset all page discoveries (for testing or "restart tour")
export function resetFeatureDiscovery() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
}
