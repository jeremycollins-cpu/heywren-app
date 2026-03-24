'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Heart, Search, Filter, Lightbulb, Send } from 'lucide-react'
import toast from 'react-hot-toast'

interface FeatureRequest {
  id: string
  title: string
  description: string
  category: 'Integration' | 'Feature' | 'UX' | 'Performance' | 'Other'
  status: 'Under Review' | 'Planned' | 'In Progress' | 'Shipped'
  author_name: string
  author_id: string
  vote_count: number
  created_at: string
  user_has_voted?: boolean
}

const CATEGORIES = ['Integration', 'Feature', 'UX', 'Performance', 'Other'] as const
const STATUSES = ['Under Review', 'Planned', 'In Progress', 'Shipped'] as const

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Integration: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  Feature: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  UX: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
  Performance: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  Other: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Under Review': { bg: 'bg-yellow-50', text: 'text-yellow-700' },
  'Planned': { bg: 'bg-blue-50', text: 'text-blue-700' },
  'In Progress': { bg: 'bg-purple-50', text: 'text-purple-700' },
  'Shipped': { bg: 'bg-green-50', text: 'text-green-700' },
}

export default function IdeasPage() {
  const supabase = createClient()

  const [ideas, setIdeas] = useState<FeatureRequest[]>([])
  const [filteredIdeas, setFilteredIdeas] = useState<FeatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('Feature')
  const [submitting, setSubmitting] = useState(false)

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)

  // Fetch user
  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (data?.user) {
        setUserId(data.user.id)
      }
    }
    fetchUser()
  }, [supabase])

  // Fetch ideas
  useEffect(() => {
    const fetchIdeas = async () => {
      try {
        setLoading(true)
        const { data: requests, error } = await supabase
          .from('feature_requests')
          .select('*')
          .order('vote_count', { ascending: false })
          .order('created_at', { ascending: false })

        if (error) throw error

        if (userId) {
          // Fetch user's votes
          const { data: votes } = await supabase
            .from('feature_request_votes')
            .select('request_id')
            .eq('user_id', userId)

          const votedIds = new Set(votes?.map(v => v.request_id) || [])

          const enrichedRequests = (requests || []).map(req => ({
            ...req,
            user_has_voted: votedIds.has(req.id),
          }))

          setIdeas(enrichedRequests)
          applyFilters(enrichedRequests)
        } else {
          setIdeas(requests || [])
          applyFilters(requests || [])
        }
      } catch (err) {
        console.error('Error fetching ideas:', err)
        toast.error('Failed to load ideas')
      } finally {
        setLoading(false)
      }
    }

    fetchIdeas()
  }, [supabase, userId])

  const applyFilters = (allIdeas: FeatureRequest[]) => {
    let filtered = allIdeas

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        idea =>
          idea.title.toLowerCase().includes(query) ||
          idea.description.toLowerCase().includes(query) ||
          idea.author_name.toLowerCase().includes(query)
      )
    }

    if (selectedCategory) {
      filtered = filtered.filter(idea => idea.category === selectedCategory)
    }

    if (selectedStatus) {
      filtered = filtered.filter(idea => idea.status === selectedStatus)
    }

    setFilteredIdeas(filtered)
  }

  useEffect(() => {
    applyFilters(ideas)
  }, [searchQuery, selectedCategory, selectedStatus])

  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!userId) {
      toast.error('Please log in to submit an idea')
      return
    }

    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in all fields')
      return
    }

    try {
      setSubmitting(true)

      // Get user info
      const { data: user } = await supabase.auth.getUser()
      const authorName = user?.user?.user_metadata?.full_name || user?.user?.email || 'Anonymous'

      const { data: newRequest, error } = await supabase
        .from('feature_requests')
        .insert({
          title: title.trim(),
          description: description.trim(),
          category,
          author_id: userId,
          author_name: authorName,
        })
        .select()
        .single()

      if (error) throw error

      // Clear form
      setTitle('')
      setDescription('')
      setCategory('Feature')

      // Add to ideas list
      const enrichedRequest = {
        ...newRequest,
        user_has_voted: false,
      }
      setIdeas([enrichedRequest, ...ideas])

      toast.success('Idea submitted! Thanks for the feedback.')
    } catch (err) {
      console.error('Error submitting idea:', err)
      toast.error('Failed to submit idea')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVote = async (ideaId: string, hasVoted: boolean) => {
    if (!userId) {
      toast.error('Please log in to vote')
      return
    }

    try {
      if (hasVoted) {
        // Remove vote
        const { error } = await supabase
          .from('feature_request_votes')
          .delete()
          .eq('request_id', ideaId)
          .eq('user_id', userId)

        if (error) throw error
      } else {
        // Add vote
        const { error } = await supabase
          .from('feature_request_votes')
          .insert({
            request_id: ideaId,
            user_id: userId,
          })

        if (error) throw error
      }

      // Update local state
      setIdeas(ideas.map(idea => {
        if (idea.id === ideaId) {
          return {
            ...idea,
            vote_count: hasVoted ? idea.vote_count - 1 : idea.vote_count + 1,
            user_has_voted: !hasVoted,
          }
        }
        return idea
      }))

      // Re-sort by votes
      applyFilters(ideas)
    } catch (err) {
      console.error('Error voting:', err)
      toast.error('Failed to update vote')
    }
  }

  const formatTimeAgo = (date: string) => {
    const now = new Date()
    const created = new Date(date)
    const seconds = Math.floor((now.getTime() - created.getTime()) / 1000)

    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return created.toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2" style={{ letterSpacing: '-0.025em' }}>
          <Lightbulb className="w-8 h-8 text-indigo-600" />
          Feature Ideas
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          Share your ideas to help shape HeyWren's future. Vote on ideas you love.
        </p>
      </div>

      {/* Submit Form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4" style={{ letterSpacing: '-0.025em' }}>
          Submit an Idea
        </h2>
        <form onSubmit={handleSubmitIdea} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's your idea?"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us more about your idea..."
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                disabled={submitting}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={submitting || !title.trim() || !description.trim()}
                className="w-full px-4 py-2 text-white rounded-lg transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
                }}
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ideas..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          {/* Category & Status Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">Filter:</span>
            </div>

            {/* Category filter */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  selectedCategory === null
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Categories
              </button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    selectedCategory === cat
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex flex-wrap gap-2 border-l border-gray-200 pl-2">
              <button
                onClick={() => setSelectedStatus(null)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  selectedStatus === null
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All Status
              </button>
              {STATUSES.map(status => (
                <button
                  key={status}
                  onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    selectedStatus === status
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ideas List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-1 px-3 py-2 flex-shrink-0">
                  <div className="w-5 h-5 bg-gray-200 rounded" />
                  <div className="w-6 h-3 bg-gray-200 rounded" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 rounded w-full" />
                  <div className="h-3 bg-gray-200 rounded w-4/5" />
                  <div className="flex gap-2 mt-3">
                    <div className="h-5 w-16 bg-gray-200 rounded-full" />
                    <div className="h-5 w-20 bg-gray-200 rounded-full" />
                    <div className="h-4 w-24 bg-gray-200 rounded" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredIdeas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white border border-gray-200 rounded-xl">
          <Lightbulb className="w-12 h-12 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No ideas yet</p>
          <p className="text-gray-400 text-sm">Be the first to share an idea!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredIdeas.map((idea) => {
            const categoryColor = CATEGORY_COLORS[idea.category]
            const statusColor = STATUS_COLORS[idea.status]

            return (
              <div
                key={idea.id}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-indigo-200 hover:shadow-md transition"
              >
                <div className="flex gap-4">
                  {/* Vote Button */}
                  <button
                    onClick={() => handleVote(idea.id, idea.user_has_voted || false)}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition flex-shrink-0 ${
                      idea.user_has_voted
                        ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Heart
                      className={`w-5 h-5 ${idea.user_has_voted ? 'fill-current' : ''}`}
                    />
                    <span className="text-xs font-semibold">{idea.vote_count}</span>
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 text-sm" style={{ letterSpacing: '-0.025em' }}>
                          {idea.title}
                        </h3>
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {idea.description}
                        </p>
                      </div>
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      {/* Category Badge */}
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium border ${categoryColor.bg} ${categoryColor.text} border-current border-opacity-30`}>
                        {idea.category}
                      </span>

                      {/* Status Badge */}
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColor.bg} ${statusColor.text} border-current border-opacity-30`}>
                        {idea.status}
                      </span>

                      {/* Author & Time */}
                      <span className="text-xs text-gray-500">
                        by <span className="font-medium text-gray-700">{idea.author_name}</span> {formatTimeAgo(idea.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
