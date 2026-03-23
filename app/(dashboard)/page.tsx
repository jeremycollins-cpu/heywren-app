'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock, AlertCircle, Zap, ArrowRight } from 'lucide-react'

interface Commitment {
  id: string
  title: string
  status: string
  source: string
  created_at: string
  description: string | null
}

interface Stats {
  total: number
  open: number
  completed: number
  overdue: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    open: 0,
    completed: 0,
    overdue: 0,
  })
  const [recentCommitments, setRecentCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [hasIntegrations, setHasIntegrations] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch commitments
        const { data: commitments } = await supabase
          .from('commitments')
          .select('id, title, status, source, created_at, description')
          .order('created_at', { ascending: false })
          .limit(20)

        const allData = commitments || []

        setStats({
          total: allData.length,
          open: allData.filter((c) => c.status === 'open').length,
          completed: allData.filter((c) => c.status === 'completed').length,
          overdue: allData.filter((c) => c.status === 'overdue').length,
        })

        setRecentCommitments(allData.slice(0, 10))

        // Check for connected integrations
        const { data: integrations } = await supabase
          .from('integrations')
          .select('id')
          .limit(1)

        setHasIntegrations((integrations || []).length > 0)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'slack':
        return 'bg-purple-100 text-purple-700'
      case 'outlook':
        return 'bg-blue-100 text-blue-700'
      case 'email':
        return 'bg-cyan-100 text-cyan-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const statCards = [
    {
      label: 'Total Commitments',
      value: stats.total,
      icon: Zap,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Open',
      value: stats.open,
      icon: Clock,
      color: 'bg-yellow-50 text-yellow-600',
    },
    {
      label: 'Completed',
      value: stats.completed,
      icon: CheckCircle2,
      color: 'bg-green-50 text-green-600',
    },
    {
      label: 'Overdue',
      value: stats.overdue,
      icon: AlertCircle,
      color: 'bg-red-50 text-red-600',
    },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">
          Welcome back! Here's an overview of your commitments.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">
                    {stat.value}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Actions */}
      {!hasIntegrations && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-indigo-900">Get more insights</h3>
              <p className="text-sm text-indigo-700 mt-1">
                Connect Slack or Outlook to automatically capture commitments from your conversations.
              </p>
            </div>
            <a
              href="/integrations"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition whitespace-nowrap"
            >
              Connect
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      )}

      {/* Recent Commitments */}
      <div className="card">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            Recent Commitments
          </h2>
          {recentCommitments.length > 0 && (
            <a href="/commitments" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">
              View all
            </a>
          )}
        </div>

        {recentCommitments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No commitments yet</p>
            <p className="text-sm text-gray-400 mt-2">
              Sync your Slack or Outlook to start capturing commitments.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recentCommitments.map((commitment) => (
              <div
                key={commitment.id}
                className="flex items-start justify-between pb-4 border-b border-gray-100 last:border-b-0 last:pb-0"
              >
                <div className="flex-1">
                  <h3 className="font-medium text-gray-900">
                    {commitment.title}
                  </h3>
                  {commitment.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                      {commitment.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                        commitment.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : commitment.status === 'open'
                          ? 'bg-blue-100 text-blue-800'
                          : commitment.status === 'overdue'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {commitment.status}
                    </span>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getSourceBadge(commitment.source)}`}>
                      {commitment.source}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(commitment.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
