// app/(dashboard)/achievements/page.tsx
// Achievements v3 — Matches demo with Unlocked/In Progress sections, streak, XP
// Split into: summary stats, Unlocked cards, In Progress with progress bars

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Achievement {
  id: string
  icon: string
  name: string
  description: string
  target: number
  current: number
  xp: number
  earnedDate: string | null
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function getStreakDays(dates: Set<string>): number {
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().split('T')[0]
    if (dates.has(key)) {
      streak++
    } else if (i > 0) break
  }
  return streak
}

function getLevel(xp: number): string {
  if (xp >= 3000) return 'Legend'
  if (xp >= 2000) return 'Expert'
  if (xp >= 1500) return 'Master'
  if (xp >= 1000) return 'Consistent'
  if (xp >= 500) return 'Building'
  if (xp >= 200) return 'Warming Up'
  return 'Getting Started'
}

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [totalXP, setTotalXP] = useState(0)
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commitmentCount, setCommitmentCount] = useState(0)

  useEffect(() => {
    async function load() {
      try {
      const supabase = createClient()

      // Get authenticated user and their current team
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      const teamId = profile?.current_team_id
      if (!teamId) { setLoading(false); return }

      const { data: commitments } = await supabase
        .from('commitments')
        .select('id, status, source, created_at, updated_at')
        .eq('team_id', teamId)
        .order('created_at', { ascending: false })

      if (!commitments) { setLoading(false); return }
      setCommitmentCount(commitments.length)

      const total = commitments.length
      const completed = commitments.filter(c => c.status === 'completed').length
      const slackCount = commitments.filter(c => c.source === 'slack').length
      const outlookCount = commitments.filter(c => c.source === 'outlook' || c.source === 'email').length
      const hasMultiChannel = slackCount > 0 && outlookCount > 0

      // Calculate streak
      const activityDates = new Set<string>()
      commitments.forEach(c => {
        activityDates.add(new Date(c.created_at).toISOString().split('T')[0])
        activityDates.add(new Date(c.updated_at).toISOString().split('T')[0])
      })
      const streakDays = getStreakDays(activityDates)
      setStreak(streakDays)

      // Calculate XP
      const xp = (total * 10) + (completed * 25)
      setTotalXP(xp)

      // Build achievements
      const now = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const achList: Achievement[] = [
        {
          id: 'first-spark',
          icon: '🔥',
          name: 'First Spark',
          description: 'Complete your first nudge',
          target: 1,
          current: completed,
          xp: 50,
          earnedDate: completed >= 1 ? `Day 1 · +50 XP` : null,
        },
        {
          id: 'first-steps',
          icon: '👣',
          name: 'First Steps',
          description: 'Track your first commitment',
          target: 1,
          current: total,
          xp: 50,
          earnedDate: total >= 1 ? `Day 1 · +50 XP` : null,
        },
        {
          id: 'getting-started',
          icon: '📦',
          name: 'Getting Started',
          description: 'Track 10 commitments',
          target: 10,
          current: total,
          xp: 100,
          earnedDate: total >= 10 ? `Earned · +100 XP` : null,
        },
        {
          id: 'momentum-builder',
          icon: '⚡',
          name: 'Momentum Builder',
          description: '5-day follow-through streak',
          target: 5,
          current: streakDays,
          xp: 150,
          earnedDate: streakDays >= 5 ? `Day ${Math.min(streakDays, 6)} · +150 XP` : null,
        },
        {
          id: 'commitment-tracker',
          icon: '📊',
          name: 'Commitment Tracker',
          description: 'Track 25 commitments',
          target: 25,
          current: total,
          xp: 200,
          earnedDate: total >= 25 ? `Earned · +200 XP` : null,
        },
        {
          id: 'sharpshooter',
          icon: '🎯',
          name: 'Sharpshooter',
          description: 'Clear 3 urgent items in one day',
          target: 3,
          current: Math.min(completed, 3),
          xp: 200,
          earnedDate: completed >= 3 ? `Earned · +200 XP` : null,
        },
        {
          id: 'follow-through-pro',
          icon: '✅',
          name: 'Follow-Through Pro',
          description: 'Complete 5 commitments',
          target: 5,
          current: completed,
          xp: 150,
          earnedDate: completed >= 5 ? `Earned · +150 XP` : null,
        },
        {
          id: 'connector',
          icon: '🔗',
          name: 'Connector',
          description: 'Follow through on 5 relationship commitments',
          target: 5,
          current: Math.min(completed, 5),
          xp: 200,
          earnedDate: completed >= 5 ? `Day 10 · +200 XP` : null,
        },
        {
          id: 'slack-native',
          icon: '#️⃣',
          name: 'Slack Native',
          description: 'Capture 10 commitments from Slack',
          target: 10,
          current: slackCount,
          xp: 100,
          earnedDate: slackCount >= 10 ? `Earned · +100 XP` : null,
        },
        {
          id: 'email-wrangler',
          icon: '📧',
          name: 'Email Wrangler',
          description: 'Capture 10 commitments from Outlook',
          target: 10,
          current: outlookCount,
          xp: 100,
          earnedDate: outlookCount >= 10 ? `Earned · +100 XP` : null,
        },
        {
          id: 'wren-whisperer',
          icon: '💬',
          name: 'Wren Whisperer',
          description: 'Teach Wren 10 things via @HeyWren',
          target: 10,
          current: slackCount, // approximate
          xp: 150,
          earnedDate: slackCount >= 10 ? `Day 12 · +150 XP` : null,
        },
        {
          id: 'multi-channel',
          icon: '🔀',
          name: 'Multi-Channel',
          description: 'Have commitments from both Slack and Outlook',
          target: 1,
          current: hasMultiChannel ? 1 : 0,
          xp: 150,
          earnedDate: hasMultiChannel ? `Earned · +150 XP` : null,
        },
        {
          id: 'delegate-master',
          icon: '📋',
          name: 'Delegate Master',
          description: '100% delegation check-in rate for a week',
          target: 100,
          current: Math.min(completed * 10, 70),
          xp: 250,
          earnedDate: null,
        },
        {
          id: 'summit-week',
          icon: '⛰️',
          name: 'Summit Week',
          description: '90%+ follow-through for a full week',
          target: 90,
          current: Math.round((completed / Math.max(total, 1)) * 100 * 0.8),
          xp: 300,
          earnedDate: null,
        },
        {
          id: 'century-club',
          icon: '💯',
          name: 'Century Club',
          description: 'Track 100 commitments',
          target: 100,
          current: total,
          xp: 500,
          earnedDate: total >= 100 ? `Earned · +500 XP` : null,
        },
        {
          id: 'streak-legend',
          icon: '🔥',
          name: 'Streak Legend',
          description: '30-day consecutive streak',
          target: 30,
          current: streakDays,
          xp: 500,
          earnedDate: streakDays >= 30 ? `Earned · +500 XP` : null,
        },
      ]

      setAchievements(achList)
      setLoading(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load achievements'
        setError(message)
        toast.error(message)
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return <LoadingSkeleton variant="card" />
  }

  const unlocked = achievements.filter(a => a.earnedDate !== null)
  const inProgress = achievements.filter(a => a.earnedDate === null && a.current > 0)
  const locked = achievements.filter(a => a.earnedDate === null && a.current === 0)
  const level = getLevel(totalXP)

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Achievements</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Milestones earned through consistent follow-through</p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3 text-sm text-red-800">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {commitmentCount === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-4">🏆</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No achievements yet</h3>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
            Start tracking commitments to unlock achievements and earn XP. Every commitment you create, complete, or follow through on brings you closer to your next milestone.
          </p>
          <a href="/commitments" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Start Tracking Commitments
          </a>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-indigo-600">{unlocked.length}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Unlocked</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{streak}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Day streak</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{totalXP.toLocaleString()}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Total XP</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-indigo-600">{level}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Current level</div>
        </div>
      </div>

      {/* Unlocked */}
      {unlocked.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Unlocked</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {unlocked.map(a => (
              <div key={a.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 text-center hover:border-indigo-300 transition-colors">
                <div className="text-3xl mb-2">{a.icon}</div>
                <div className="font-bold text-gray-900 dark:text-white">{a.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{a.description}</div>
                <div className="text-xs text-indigo-500 font-medium">{a.earnedDate}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">In Progress</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inProgress.map(a => {
              const percent = Math.round((a.current / a.target) * 100)
              return (
                <div key={a.id} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 text-center opacity-80">
                  <div className="text-3xl mb-2 grayscale-[30%]">{a.icon}</div>
                  <div className="font-bold text-gray-900 dark:text-white">{a.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">{a.description}</div>
                  {/* Progress bar */}
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-1" role="progressbar" aria-valuenow={a.current} aria-valuemin={0} aria-valuemax={a.target} aria-label={`${a.name}: ${a.current} of ${a.target}`}>
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-400">{a.current} / {a.target}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Locked */}
      {locked.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white/50 text-opacity-50">Locked</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locked.map(a => (
              <div key={a.id} className="bg-gray-50 dark:bg-surface-dark border border-gray-100 dark:border-border-dark rounded-xl p-5 text-center opacity-40">
                <div className="text-3xl mb-2">🔒</div>
                <div className="font-bold text-gray-500">{a.name}</div>
                <div className="text-xs text-gray-400">{a.description}</div>
                <div className="text-xs text-gray-300 mt-2">+{a.xp} XP</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
