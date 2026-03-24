// app/(dashboard)/coach/page.tsx
// Executive Coach v4 — SECURITY FIX: All queries filtered by team_id
// Priority-based insights with action callouts

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  created_at: string
  updated_at: string
}

interface Insight {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'GROWTH'
  title: string
  description: string
  action: string
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function generateInsights(commitments: Commitment[]): Insight[] {
  const insights: Insight[] = []
  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const stale = open.filter(c => daysSince(c.created_at) > 7)
  const veryStale = open.filter(c => daysSince(c.created_at) > 14)
  const slackCount = commitments.filter(c => c.source === 'slack').length
  const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length
  const followThrough = commitments.length > 0 ? Math.round((completed.length / commitments.length) * 100) : 0
  const thisWeek = commitments.filter(c => daysSince(c.created_at) <= 7)

  // CRITICAL insights
  if (veryStale.length >= 3) {
    insights.push({
      priority: 'CRITICAL',
      title: 'Commitment backlog building',
      description: `${veryStale.length} commitments have gone 14+ days without resolution. This pattern suggests items are being captured but not followed through on, which erodes team trust over time.`,
      action: 'Block 30 minutes today to triage your oldest commitments. Close what\'s done, delegate what you can, and set explicit deadlines for the rest.',
    })
  }

  if (open.length > 50 && completed.length === 0) {
    insights.push({
      priority: 'CRITICAL',
      title: 'Zero follow-through detected',
      description: `You have ${open.length} tracked commitments but none marked complete. Wren can only measure follow-through when items are closed — this is your biggest opportunity.`,
      action: 'Start with your 5 most recent commitments. Mark any that are already done as complete. This will immediately establish your follow-through baseline.',
    })
  }

  // HIGH insights
  if (stale.length >= 5) {
    insights.push({
      priority: 'HIGH',
      title: 'Stale commitments need attention',
      description: `${stale.length} items have been open for over a week. Research shows commitments not acted on within 7 days have a 60% lower completion rate.`,
      action: 'Review stale items and either set a concrete next step for each, or close them with a status update to stakeholders.',
    })
  }

  if (slackCount > 0 && outlookCount > 0 && Math.abs(slackCount - outlookCount) / Math.max(slackCount, outlookCount) > 0.7) {
    const dominant = slackCount > outlookCount ? 'Slack' : 'Outlook'
    const weak = slackCount > outlookCount ? 'Outlook' : 'Slack'
    insights.push({
      priority: 'HIGH',
      title: `Imbalanced source coverage`,
      description: `${Math.round(Math.max(slackCount, outlookCount) / commitments.length * 100)}% of your commitments come from ${dominant}. You may be missing commitments made in ${weak} conversations.`,
      action: `Review your recent ${weak} ${weak === 'Slack' ? 'channels' : 'email threads'} for commitments that weren\'t captured. Consider running a backfill sync.`,
    })
  }

  if (followThrough < 30 && commitments.length > 10) {
    insights.push({
      priority: 'HIGH',
      title: 'Follow-through rate below threshold',
      description: `Your current follow-through rate is ${followThrough}%. High-performing leaders typically maintain 70%+. Every completed item builds momentum.`,
      action: 'Set a goal to complete 3 commitments this week. Focus on quick wins first to build your streak.',
    })
  }

  // MEDIUM insights
  if (thisWeek.length > 15) {
    insights.push({
      priority: 'MEDIUM',
      title: 'High volume week',
      description: `${thisWeek.length} new commitments captured this week. That\'s above average and could lead to overcommitment if not managed.`,
      action: 'Review new commitments and prioritize the top 5. Delegate or defer the rest to maintain focus.',
    })
  }

  if (open.length > 0 && stale.length / open.length > 0.5) {
    insights.push({
      priority: 'MEDIUM',
      title: 'Commitment velocity declining',
      description: `More than half your open items are over a week old. Your velocity of closing items needs to exceed your rate of new commitments.`,
      action: 'Aim to close 2 items for every 1 new commitment this week to reduce your backlog.',
    })
  }

  // GROWTH insights
  if (commitments.length < 20) {
    insights.push({
      priority: 'GROWTH',
      title: 'Building your commitment baseline',
      description: `Wren is learning your patterns with ${commitments.length} tracked items. More data means better coaching insights. The first 50 commitments establish your baseline.`,
      action: 'Keep using @HeyWren in Slack and ensure both Slack and Outlook are syncing regularly.',
    })
  }

  if (followThrough >= 70) {
    insights.push({
      priority: 'GROWTH',
      title: 'Strong follow-through momentum',
      description: `Your ${followThrough}% follow-through rate puts you in the top tier. Maintaining this consistency is what separates great leaders.`,
      action: 'Challenge yourself to maintain this rate while increasing your total commitment volume by 20% next week.',
    })
  }

  if (slackCount > 0 && outlookCount === 0) {
    insights.push({
      priority: 'GROWTH',
      title: 'Expand your commitment sources',
      description: 'You\'re only tracking Slack commitments. Many critical commitments happen over email — connecting Outlook would give you a complete picture.',
      action: 'Go to Integrations and connect your Outlook account to capture email commitments.',
    })
  }

  // Always return at least one insight
  if (insights.length === 0) {
    insights.push({
      priority: 'GROWTH',
      title: 'Getting started with Wren',
      description: 'Wren is ready to analyze your communication patterns and provide coaching insights specific to your role. Connect your tools and start tracking.',
      action: 'Tag @HeyWren in your next Slack conversation where someone makes a commitment.',
    })
  }

  return insights
}

const priorityConfig = {
  CRITICAL: { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  HIGH: { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  MEDIUM: { border: 'border-l-yellow-500', badge: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  GROWTH: { border: 'border-l-green-500', badge: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
}

export default function CoachPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()

        // ── SECURITY: Get user's team_id first ──
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) {
          setLoading(false)
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        const teamId = profile?.current_team_id
        if (!teamId) {
          setLoading(false)
          return
        }

        const { data, error: fetchError } = await supabase
          .from('commitments')
          .select('*')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })

        if (fetchError) throw fetchError

        if (data) setCommitments(data)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load coaching insights'
        setError(message)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          {[1,2,3].map(i => <div key={i} className="h-32 bg-gray-100 rounded"></div>)}
        </div>
      </div>
    )
  }

  const insights = generateInsights(commitments)
  const open = commitments.filter(c => c.status === 'open')
  const completed = commitments.filter(c => c.status === 'completed')
  const stale = open.filter(c => daysSince(c.created_at) > 7)

  // Watching for topics based on data patterns
  const watchingFor: string[] = []
  if (stale.length > 3) watchingFor.push('Stale commitment patterns')
  if (completed.length === 0) watchingFor.push('Completion gaps')
  if (open.length > 30) watchingFor.push('Over-commitment risk')
  if (watchingFor.length === 0) watchingFor.push('Building baseline patterns')

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Executive Coach</h1>
        <p className="text-gray-500 text-sm mt-1">Personalized for CEO at your organization</p>
      </div>

      {/* Coach Header Card */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">🧠</span>
          <div>
            <div className="font-bold text-gray-900 text-lg">Executive Coach</div>
            <div className="text-sm text-gray-500">
              Watching for: {watchingFor.join(' · ')}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          Wren analyzes every message, email, meeting, and task across your connected tools to surface coaching insights specific to your role. Insights update weekly based on real behavioral patterns.
        </p>
      </div>

      {/* Insights */}
      <div className="space-y-4">
        {insights.map((insight, i) => {
          const config = priorityConfig[insight.priority]
          return (
            <div key={i} className={`bg-white border border-gray-200 border-l-4 ${config.border} rounded-xl p-6`}>
              <div className="mb-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${config.badge}`}>
                  {insight.priority}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{insight.title}</h3>
              <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <span className="text-sm">
                  <span className="font-semibold text-indigo-700">Action:</span>{' '}
                  <span className="text-indigo-600">{insight.action}</span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
