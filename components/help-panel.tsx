'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { X, HelpCircle, Lightbulb, MessageSquare, ExternalLink } from 'lucide-react'
import { resetWalkthrough } from './walkthrough'
import { resetFeatureDiscovery } from './feature-discovery'

interface HelpTip {
  title: string
  description: string
  icon: React.ReactNode
}

const HELP_CONTENT: Record<string, HelpTip[]> = {
  '/': [
    {
      title: 'Track Your Progress',
      description: 'Use your dashboard to see all active commitments at a glance. The progress bars show you how well you\'re following through.',
      icon: '📊',
    },
    {
      title: 'Weekly Reviews Matter',
      description: 'Spend 15 minutes every week reviewing what you committed to and how you followed through. It builds self-awareness.',
      icon: '📝',
    },
    {
      title: 'Connect Your Tools',
      description: 'Link Slack, Outlook, and other platforms to automatically capture commitments you make in real conversations.',
      icon: '⚡',
    },
  ],
  '/commitments': [
    {
      title: 'Create Clear Commitments',
      description: 'Be specific about what you\'re committing to. Include who it\'s for and when you\'ll deliver. This helps you follow through.',
      icon: '✓',
    },
    {
      title: 'Use Status Updates',
      description: 'Keep statuses updated as you work. Mark things in progress, and complete when done. It keeps you accountable.',
      icon: '📌',
    },
    {
      title: 'Set Reminders',
      description: 'Schedule reminders before your commitments are due. This gives you time to course-correct if needed.',
      icon: '🔔',
    },
  ],
  '/relationships': [
    {
      title: 'Build Relationship History',
      description: 'Keep notes on your key relationships. Track what you\'ve discussed and commitments made to each person.',
      icon: '👥',
    },
    {
      title: 'Follow-Through Creates Trust',
      description: 'The more you follow through on commitments to specific people, the stronger your relationships become.',
      icon: '🤝',
    },
    {
      title: 'Sync Frequently',
      description: 'Regular check-ins with key relationships help you stay aligned and catch issues early.',
      icon: '💬',
    },
  ],
  '/coach': [
    {
      title: 'Get AI-Powered Insights',
      description: 'Your coach analyzes your follow-through patterns and gives you personalized coaching to improve.',
      icon: '🧠',
    },
    {
      title: 'Reflect on Patterns',
      description: 'Look for patterns in what commitments you struggle with. This awareness helps you make better commitments.',
      icon: '🔍',
    },
    {
      title: 'Take Action on Advice',
      description: 'The best coaching is only valuable if you implement it. Pick one insight and try it this week.',
      icon: '🎯',
    },
  ],
  '/weekly': [
    {
      title: 'Celebrate Your Wins',
      description: 'Start your weekly review by celebrating what you completed. This builds momentum and confidence.',
      icon: '🎉',
    },
    {
      title: 'Be Honest About Misses',
      description: 'Look at commitments you didn\'t follow through on. Understand why. This is where real growth happens.',
      icon: '💡',
    },
    {
      title: 'Plan for Next Week',
      description: 'End your review by planning the week ahead. Set realistic commitments based on your capacity.',
      icon: '📅',
    },
  ],
  '/playbooks': [
    {
      title: 'Reuse Successful Patterns',
      description: 'Save the processes that work well. Use playbooks to replicate your best work consistently.',
      icon: '📖',
    },
    {
      title: 'Document Your Process',
      description: 'Write down how you successfully handled past situations. This becomes your playbook for the future.',
      icon: '✍️',
    },
    {
      title: 'Share and Collaborate',
      description: 'Share proven playbooks with your team to multiply your impact across the organization.',
      icon: '🔗',
    },
  ],
  '/draft-queue': [
    {
      title: 'Thoughtful Over Fast',
      description: 'Draft important messages before sending. This gives you time to think through your response.',
      icon: '✎',
    },
    {
      title: 'Review Before Sending',
      description: 'Your drafts are saved and ready. Review them when you\'re in a calm, focused state before hitting send.',
      icon: '👀',
    },
    {
      title: 'Batch and Send',
      description: 'Review and send multiple drafts together. This is more efficient than writing and sending on the fly.',
      icon: '📬',
    },
  ],
  '/briefings': [
    {
      title: 'Daily Briefings Save Time',
      description: 'Read your daily briefing to quickly see what\'s urgent, upcoming, and what you should focus on today.',
      icon: '📰',
    },
    {
      title: 'Personalized for You',
      description: 'Your briefing learns from your patterns. It surfaces the most important things first.',
      icon: '⭐',
    },
    {
      title: 'Stay in the Loop',
      description: 'Briefings pull from all your connected tools, so nothing important falls through the cracks.',
      icon: '🔔',
    },
  ],
  '/handoff': [
    {
      title: 'Clear Handoffs = Clear Ownership',
      description: 'When passing work to others, be specific about what you\'re handing off and what done looks like.',
      icon: '🙌',
    },
    {
      title: 'Document Context',
      description: 'Leave context with your handoffs. The more someone understands, the better they\'ll execute.',
      icon: '📄',
    },
    {
      title: 'Follow Up Appropriately',
      description: 'Check in at the right cadence. This shows you care and catches issues early.',
      icon: '✔️',
    },
  ],
  '/achievements': [
    {
      title: 'Celebrate Consistency',
      description: 'Your achievements aren\'t just big wins. Consistent follow-through on small commitments is a big deal.',
      icon: '🏆',
    },
    {
      title: 'See Your Progress',
      description: 'Look back regularly at what you\'ve accomplished. This builds confidence for future commitments.',
      icon: '📈',
    },
    {
      title: 'Share Your Success',
      description: 'Don\'t be shy about sharing your achievements with your coach and team. It inspires others.',
      icon: '🎊',
    },
  ],
  '/integrations': [
    {
      title: 'More Integrations = Better Data',
      description: 'The more tools you connect, the more complete HeyWren\'s view of your commitments becomes.',
      icon: '🔗',
    },
    {
      title: 'Automatic Capture',
      description: 'Once integrated, commitments made in Slack, email, or elsewhere are automatically tracked for you.',
      icon: '⚙️',
    },
    {
      title: 'Secure & Private',
      description: 'HeyWren uses read-only OAuth. Your data stays secure and private. Your integrations can be disconnected anytime.',
      icon: '🔒',
    },
  ],
  '/settings': [
    {
      title: 'Customize Your Experience',
      description: 'Update your profile, notification preferences, and other settings to make HeyWren work for you.',
      icon: '⚙️',
    },
    {
      title: 'Privacy Controls',
      description: 'Control how your data is used and who can see your information. Your privacy matters.',
      icon: '👁️',
    },
    {
      title: 'Manage Subscriptions',
      description: 'Upgrade, downgrade, or cancel your subscription anytime. Manage your plan from here.',
      icon: '💳',
    },
  ],
}

interface HelpPanelProps {
  open: boolean
  onClose: () => void
  onStartWalkthrough: () => void
}

export default function HelpPanel({ open, onClose, onStartWalkthrough }: HelpPanelProps) {
  const pathname = usePathname()
  const [tips, setTips] = useState<HelpTip[]>([])

  useEffect(() => {
    // Get the base path (remove dynamic segments)
    let basePath = pathname
    if (pathname.includes('/ideas')) {
      basePath = '/ideas'
    } else if (!HELP_CONTENT[pathname]) {
      // Try to find matching path
      const possiblePaths = Object.keys(HELP_CONTENT)
      basePath = possiblePaths.find(p => pathname.startsWith(p)) || '/'
    }

    setTips(HELP_CONTENT[basePath] || HELP_CONTENT['/'])
  }, [pathname])

  const handleStartWalkthrough = () => {
    resetWalkthrough()
    onStartWalkthrough()
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Help Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl transition-transform duration-300 z-50 flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-white" />
            </div>
            <h2 className="font-semibold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
              Help & Tips
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
          {/* Tips */}
          {tips.map((tip, idx) => (
            <div key={idx} className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-4 border border-indigo-100/50">
              <div className="flex items-start gap-3">
                <div className="text-xl flex-shrink-0 mt-0.5">{tip.icon}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm" style={{ letterSpacing: '-0.025em' }}>
                    {tip.title}
                  </h3>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                    {tip.description}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* Actions */}
          <div className="space-y-3 pt-6 border-t border-gray-200 mt-6">
            <button
              onClick={handleStartWalkthrough}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white rounded-lg transition font-medium text-sm"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
              }}
            >
              <Lightbulb className="w-4 h-4" />
              Take a Tour
            </button>

            <button
              onClick={() => {
                resetFeatureDiscovery()
                onClose()
                window.location.reload()
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium text-sm"
            >
              <HelpCircle className="w-4 h-4" />
              Restart Page Guides
            </button>

            <a
              href="/ideas"
              className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-200 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium text-sm"
            >
              <MessageSquare className="w-4 h-4" />
              Share an Idea
              <ExternalLink className="w-3 h-3 ml-1" />
            </a>
          </div>

          {/* Footer */}
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100 text-center mt-6">
            <p className="text-xs text-blue-700 leading-relaxed">
              Have a question? Check out our{' '}
              <a href="#" className="font-semibold underline hover:text-blue-800">
                docs
              </a>
              {' '}or email us at{' '}
              <a href="mailto:help@heywren.com" className="font-semibold underline hover:text-blue-800">
                help@heywren.com
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
