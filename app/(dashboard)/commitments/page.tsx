'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, CheckCircle2, RotateCcw } from 'lucide-react'

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string
  due_date: string | null
  created_at: string
}

export default function CommitmentsPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const fetchCommitments = async () => {
      try {
        let query = supabase
          .from('commitments')
          .select('id, title, description, status, source, due_date, created_at')
          .order('created_at', { ascending: false })

        if (filter !== 'all') {
          query = query.eq('status', filter)
        }

        const { data, error } = await query

        if (error) {
          console.error('Commitments query error:', error)
        }

        setCommitments(data || [])
      } catch (err) {
        console.error('Error fetching commitments:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchCommitments()
  }, [filter, supabase])

  const handleMarkComplete = async (id: string) => {
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'completed' })
      .eq('id', id)

    if (!error) {
      setCommitments(
        commitments.map((c) =>
          c.id === id ? { ...c, status: 'completed' } : c
        )
      )
    }
  }

  const handleReopen = async (id: string) => {
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'open' })
      .eq('id', id)

    if (!error) {
      setCommitments(
        commitments.map((c) =>
          c.id === id ? { ...c, status: 'open' } : c
        )
      )
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('commitments')
      .delete()
      .eq('id', id)

    if (!error) {
      setCommitments(commitments.filter((c) => c.id !== id))
    }
  }

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'slack':
        return 'bg-purple-100 text-purple-700'
      case 'outlook':
        return 'bg-blue-100 text-blue-700'
      case 'email':
        return 'bg-cyan-100 text-cyan-700'
      case 'meeting':
        return 'bg-orange-100 text-orange-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Loading commitments...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Commitments</h1>
        <p className="text-gray-600 mt-1">
          Track and manage all your tracked commitments
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'open', 'completed', 'overdue'].map(
          (filterVal) => (
            <button
              key={filterVal}
              onClick={() => { setFilter(filterVal); setLoading(true) }}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                filter === filterVal
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {filterVal === 'all' ? 'All' : filterVal.charAt(0).toUpperCase() + filterVal.slice(1)}
              {filterVal !== 'all' && (
                <span className="ml-2 text-xs opacity-75">
                  ({commitments.filter(c => filterVal === 'all' || c.status === filterVal).length})
                </span>
              )}
            </button>
          )
        )}
      </div>

      {/* Summary bar */}
      {commitments.length > 0 && (
        <div className="flex items-center gap-6 text-sm text-gray-600">
          <span>{commitments.length} commitment{commitments.length !== 1 ? 's' : ''}</span>
          <span className="text-blue-600">{commitments.filter(c => c.source === 'slack').length} from Slack</span>
          <span className="text-indigo-600">{commitments.filter(c => c.source === 'outlook').length} from Outlook</span>
        </div>
      )}

      {/* Commitments List */}
      <div className="space-y-4">
        {commitments.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No commitments found</p>
            <p className="text-sm text-gray-400 mt-2">
              {filter !== 'all' ? 'Try a different filter or ' : ''}
              Sync your integrations to capture commitments.
            </p>
          </div>
        ) : (
          commitments.map((commitment) => (
            <div key={commitment.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-gray-900">
                        {commitment.title}
                      </h3>
                      {commitment.description && (
                        <p className="text-gray-600 mt-2">
                          {commitment.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-4 flex-wrap">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
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
                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getSourceBadge(commitment.source)}`}>
                          {commitment.source}
                        </span>
                        {commitment.due_date && (
                          <span className="text-xs text-gray-500">
                            Due: {new Date(commitment.due_date).toLocaleDateString()}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(commitment.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 ml-4">
                  {commitment.status !== 'completed' ? (
                    <button
                      onClick={() => handleMarkComplete(commitment.id)}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                      title="Mark complete"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReopen(commitment.id)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      title="Reopen"
                    >
                      <RotateCcw className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(commitment.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
