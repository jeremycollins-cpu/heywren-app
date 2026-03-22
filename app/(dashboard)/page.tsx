'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Clock, AlertCircle, Zap } from 'lucide-react'

interface Commitment {
  id: string
  title: string
  status: string
  priority_score: number
  created_at: string
}

interface Stats {
  total: number
  pending: number
  completed: number
  overdue: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    pending: 0,
    completed: 0,
    overdue: 0,
  })
  const [recentCommitments, setRecentCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: commitments } = await supabase
          .from('commitments')
          .select('id, title, status, priority_score, created_at')
          .order('created_at', { ascending: false })
          .limit(10)

        const allData = commitments || []

        setStats({
          total: allData.length,
          pending: allData.filter((c) => c.status === 'pending').length,
          completed: allData.filter((c) => c.status === 'completed').length,
          overdue: allData.filter((c) => c.status === 'overdue').length,
        })

        setRecentCommitments(allData)
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [supabase])

  const statCards = [
    {
      label: 'Total Commitments',
      value: stats.total,
      icon: Zap,
      color: 'bg-blue-50 text-blue-600',
    },
    {
      label: 'Pending',
      value: stats.pending,
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

      {/* Recent Commitments */}
      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Recent Commitments
        </h2>

        {recentCommitments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No commitments yet</p>
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
                  <div className="flex items-center gap-3 mt-2">
                    <span
                      className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                        commitment.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : commitment.status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {commitment.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(commitment.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-indigo-600">
                    {(commitment.priority_score * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-500">confidence</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
