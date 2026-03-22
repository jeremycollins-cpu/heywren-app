'use client'

import { useState } from 'react'
import { Trophy, Flame, Zap, TrendingUp } from 'lucide-react'

interface Achievement {
  id: string
  name: string
  description: string
  progress: number
  unlocked: boolean
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
}

const achievements: Achievement[] = [
  {
    id: '1',
    name: 'First Steps',
    description: 'Complete your first commitment',
    progress: 100,
    unlocked: true,
    rarity: 'common',
  },
  {
    id: '2',
    name: 'On a Roll',
    description: 'Complete 10 commitments in a week',
    progress: 100,
    unlocked: true,
    rarity: 'rare',
  },
  {
    id: '3',
    name: 'Unstoppable',
    description: 'Build a 30-day follow-through streak',
    progress: 73,
    unlocked: false,
    rarity: 'epic',
  },
  {
    id: '4',
    name: 'Legendary',
    description: 'Complete 365 consecutive days of commitments',
    progress: 12,
    unlocked: false,
    rarity: 'legendary',
  },
  {
    id: '5',
    name: 'Connector',
    description: 'Maintain 50+ healthy relationships',
    progress: 38,
    unlocked: false,
    rarity: 'rare',
  },
  {
    id: '6',
    name: 'Team Player',
    description: 'Delegate 20 commitments to team members',
    progress: 85,
    unlocked: false,
    rarity: 'epic',
  },
]

export default function AchievementsPage() {
  const [streakDays, setStreakDays] = useState(0)
  const [totalXP, setTotalXP] = useState(0)
  const [level, setLevel] = useState(1)
  const [hasActivity, setHasActivity] = useState(false)

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

  if (!hasActivity) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Achievements</h1>
          <p className="text-gray-600 mt-1">
            Milestones earned through consistent follow-through — gamification inspired by Strava
          </p>
        </div>

        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <Trophy className="w-8 h-8 text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Unlock Achievements</h3>
          <p className="text-gray-500 max-w-md mb-6">
            Complete your first commitment to start earning achievements, building streaks, and gaining XP. Track your progress as you improve your follow-through skills.
          </p>
          <a href="/dashboard/commitments" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            View Commitments
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Achievements</h1>
        <p className="text-gray-600 mt-1">
          Milestones earned through consistent follow-through — gamification inspired by Strava
        </p>
      </div>

      {/* Streak & Level Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-red-50 to-orange-50 border-2 border-red-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Current Streak</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-red-600">{streakDays}</span>
                <span className="text-gray-600">days</span>
              </div>
            </div>
            <Flame className="w-12 h-12 text-red-500" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Level</p>
              <p className="text-4xl font-bold text-indigo-600">{level}</p>
              <p className="text-xs text-gray-600 mt-1">Expert</p>
            </div>
            <Zap className="w-12 h-12 text-indigo-500" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-400 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 mb-1">Total XP</p>
              <p className="text-4xl font-bold text-green-600">{totalXP.toLocaleString()}</p>
              <div className="w-32 bg-gray-200 rounded-full h-2 mt-3">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '65%' }} />
              </div>
            </div>
            <TrendingUp className="w-12 h-12 text-green-500" />
          </div>
        </div>
      </div>

      {/* Leaderboard - Team feature coming soon */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Team Leaderboard</h2>
        <p className="text-gray-600 mb-4">Team leaderboard coming soon. Invite team members to start competing and tracking progress together.</p>
        <a href="/dashboard/settings" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Invite Team Members
        </a>
      </div>

      {/* Achievements Grid */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Achievements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {achievements.map((achievement) => (
            <div
              key={achievement.id}
              className={`border-2 rounded-lg p-6 transition-all ${
                getRarityColor(achievement.rarity)
              } ${achievement.unlocked ? 'opacity-100' : 'opacity-75'}`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{achievement.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{achievement.description}</p>
                </div>
                {achievement.unlocked && (
                  <Trophy className="w-6 h-6 text-yellow-500" />
                )}
              </div>

              {!achievement.unlocked && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-600">Progress</span>
                    <span className="text-xs font-medium text-gray-600">{achievement.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-indigo-600 h-2 transition-all rounded-full"
                      style={{ width: `${achievement.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 mb-2">How Gamification Works</h3>
        <ul className="text-sm text-indigo-800 space-y-1">
          <li>✓ Earn XP for every completed commitment</li>
          <li>✓ Build daily streaks like Strava</li>
          <li>✓ Unlock achievements by hitting milestones</li>
          <li>✓ Compete with your team on the leaderboard</li>
          <li>✓ Level up to unlock new features</li>
        </ul>
      </div>
    </div>
  )
}
