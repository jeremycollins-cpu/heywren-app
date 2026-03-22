'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Trash2, Edit2, CheckCircle2 } from 'lucide-react'

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  priority_score: number
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
          .select('*')
          .order('created_at', { ascending: false })

        if (filter !== 'all') {
          query = query.eq('status', filter)
        }

        const { data } = await query

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

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('commitments')
      .delete()
      .eq('id', id)

    if (!error) {
      setCommitments(commitments.filter((c) => c.id !== id))
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
        {['all', 'pending', 'in_progress', 'completed', 'overdue'].map(
          (filterVal) => (
            <button
              key={filterVal}
              onClick={() => setFilter(filterVal)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                filter === filterVal
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {filterVal.charAt(0).toUpperCase() + filterVal.slice(1)}
            </button>
          )
        )}
      </div>

      {/* Commitments List */}
      <div className="space-y-4">
        {commitments.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No commitments found</p>
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
                              : commitment.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : commitment.status === 'overdue'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {commitment.status}
                        </span>
                        {commitment.due_date && (
                          <span className="text-xs text-gray-500">
                            Due: {new Date(commitment.due_date).toLocaleDateString()}
                          </span>
                        )}
                        <span className="text-xs text-indigo-600 font-medium">
                          {(commitment.priority_score * 100).toFixed(0)}% confidence
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 ml-4">
                  {commitment.status !== 'completed' && (
                    <button
                      onClick={() => handleMarkComplete(commitment.id)}
                      className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                      title="Mark complete"
                    >
                      <CheckCircle2 className="w-5 h-5" />
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
