'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trophy, Flame, Zap, TrendingUp, Target, Users, Calendar, Star } from 'lucide-react'

interface Achievement {
  id: string
  name: string
  description: string
  progress: number
  target: number
  unlocked: boolean
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  icon: string
}

export default function AchievementsPage() {
  const [totalCommitments, setTotalCommitments] = useState(0)
  const [completedCommitments, setCompletedCommitments] = useState(0)
  const [loading, setLoading] = useState(true)
  const [achievements, setAchievements] = useState<Achievement[]>([])

  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: commitments } = await supabase
          .from('commitments')
          .select('id, status, source, created_at')

        const all = commitments || []
        const completed = all.filter(c => c.status === 'completed').length
        const total = all.length
        const slackCount = all.filter(c => c.source === 'slack').length
        const outlookCount = all.filter(c => c.source === 'outlook').length

        setTotalCommitments(total)
        setCompletedCommitments(completed)

        // Generate achievements based on real data
        setAchievements([
          {
            id: '1',
            name: 'First Steps',
            description: 'Track your first commitment',
            progress: Math.min(total, 1),
            target: 1,
            unlocked: total >= 1,
            rarity: 'common',
            icon: '🎯',
          },
          {
            id: '2',
            name: 'Getting Started',
            description: 'Track 10 commitments',
            progress: Math.min(total, 10),
            target: 10,
            unlocked: total >= 10,
            rarity: 'common',
            icon: '📋',
          },
          {
            id: '3',
            name: 'Commitment Tracker',
            description: 'Track 25 commitments',
            progress: Math.min(total, 25),
            target: 25,
            unlocked: total >= 25,
            rarity: 'rare',
            icon: '📊',
          },
          {
            id: '4',
            name: 'Follow-Through Pro',
            description: 'Complete 5 commitments',
            progress: Math.min(completed, 5),
            target: 5,
            unlocked: completed >= 5,
            rarity: 'rare',
            icon: '✅',
          },
          {
            id: '5',
            name: 'Closer',
            description: 'Complete 25 commitments',
            progress: Math.min(completed, 25),
            target: 25,
            unlocked: completed >= 25,
            rarity: 'epic',
            icon: '🏆',
          },
          {
            id: '6',
            name: 'Slack Native',
            description: 'Capture 10 commitments from Slack',
            progress: Math.min(slackCount, 10),
            target: 10,
            unlocked: slackCount >= 10,
            rarity: 'common',
            icon: '#️⃣',
          },
          {
            id: '7',
            name: 'Email Wrangler',
            description: 'Capture 10 commitments from Outlook',
            progress: Math.min(outlookCount, 10),
            target: 10,
            unlocked: outlookCount >= 10,
            rarity: 'common',
            icon: '📧',
          },
          {
            id: '8',
            name: 'Multi-Channel',
            description: 'Have commitments from both Slack and Outlook',
            progress: (slackCount > 0 ? 1 : 0) + (outlookCount > 0 ? 1 : 0),
            target: 2,
            unlocked: slackCount > 0 && outlookCount > 0,
            rarity: 'rare',
            icon: '🔗',
          },
          {
            id: '9',
            name: 'Century Club',
            description: 'Track 100 commitments',
            progress: Math.min(total, 100),
            target: 100,
            unlocked: total >= 100,
            rarity: 'epic',
            icon: '💯',
          },
          {
            id: '10',
            name: 'Legendary Leader',
            description: 'Complete 100 commitments',
            progress: Math.min(completed, 100),
            target: 100,
            unlocked: completed >= 100,
            rarity: 'legendary',
            icon: '👑',
          },
        ])
      } catch (err) {
        console.error('Error fetching achievements data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case 'legendary':
        return 'border-yellow-400 bg-gradient-to-br from-yellow-50 to-orange-50'
      case 'epic':
        return 'border-purple-400 bg-gradient-to-br from-purple-50 to-pink-50'
      case 'rare':
        return 'border-blue-400 bg-gradient-to-br from-blue-50 to-cyan-50'
      default:
        return 'border-gray-300 bg-gray-50'
    }
  }

  const getRarityLabel = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return 'bg-yellow-100 text-yellow-700'
      case 'epic': return 'bg-purple-100 text-purple-700'
      case 'rare': return 'bg-blue-100 text-blue-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading achievements...</p>
      </div>
    )
  }

  const unlockedCount = achievements.filter(a => a.unlocked).length
  const xp = totalCommitments * 10 + completedCommitments * 25
  const level = Math.floor(xp / 100) + 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Achievements</h1>
        <p className="text-gray-600 mt-1">
          Milestones earned through consistent follow-through
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Level</p>
              <p className="text-4xl font-bold text-indigo-600">{level}</p>
              <div className="w-32 bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${(xp % 100)}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1">{xp % 100}/100 XP to next level</p>
            </div>
            <Zap className="w-12 h-12 text-indigo-500" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total XP</p>
              <p className="text-4xl font-bold text-green-600">{xp}</p>
              <p className="text-xs text-gray-500 mt-1">+10 per tracked, +25 per completed</p>
            </div>
            <TrendingUp className="w-12 h-12 text-green-500" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-yellow-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Achievements</p>
              <p className="text-4xl font-bold text-yellow-600">{unlockedCount}/{achievements.length}</p>
              <p className="text-xs text-gray-500 mt-1">unlocked</p>
            </div>
            <Trophy className="w-12 h-12 text-yellow-500" />
          </div>
        </div>
      </div>

      {/* Achievements Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">All Achievements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {achievements.map((achievement) => (
            <div
              key={achievement.id}
              className={`border-2 rounded-lg p-6 transition-all ${
                getRarityColor(achievement.rarity)
              } ${achievement.unlocked ? 'opacity-100 shadow-md' : 'opacity-70'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-3xl">{achievement.icon}</span>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getRarityLabel(achievement.rarity)}`}>
                    {achievement.rarity}
                  </span>
                  {achievement.unlocked && (
                    <Trophy className="w-5 h-5 text-yellow-500" />
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900">{achievement.name}</h3>
              <p className="text-sm text-gray-600 mt-1">{achievement.description}</p>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">
                    {achievement.progress}/{achievement.target}
                  </span>
                  <span className="text-xs font-medium text-gray-600">
                    {Math.round((achievement.progress / achievement.target) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 transition-all rounded-full ${achievement.unlocked ? 'bg-green-500' : 'bg-indigo-600'}`}
                    style={{ width: `${Math.min((achievement.progress / achievement.target) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
