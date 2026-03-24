'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ChevronUp, Search, Filter, Lightbulb, Send, Paperclip, X,
  Image as ImageIcon, FileText, ArrowUpDown,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface Attachment {
  url: string
  name: string
  type: string
  size: number
}

interface FeatureRequest {
  id: string
  title: string
  description: string
  category: 'Integration' | 'Feature' | 'UX' | 'Performance' | 'Other'
  status: 'Under Review' | 'Planned' | 'In Progress' | 'Shipped'
  author_name: string
  author_id: string
  vote_count: number
  attachments: Attachment[] | null
  created_at: string
  user_has_voted?: boolean
}

const CATEGORIES = ['Integration', 'Feature', 'UX', 'Performance', 'Other'] as const
const STATUSES = ['Under Review', 'Planned', 'In Progress', 'Shipped'] as const

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Integration: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400' },
  Feature: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-400' },
  UX: { bg: 'bg-pink-50 dark:bg-pink-900/20', text: 'text-pink-700 dark:text-pink-400' },
  Performance: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400' },
  Other: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400' },
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Under Review': { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400' },
  'Planned': { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400' },
  'In Progress': { bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-700 dark:text-violet-400' },
  'Shipped': { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400' },
}

type SortMode = 'votes' | 'newest' | 'oldest'

export default function IdeasPage() {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [ideas, setIdeas] = useState<FeatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('Feature')
  const [submitting, setSubmitting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('votes')

  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (data?.user) {
        setUserId(data.user.id)
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', data.user.id)
          .single()
        if (profile?.current_team_id) {
          setTeamId(profile.current_team_id)
        }
      }
    }
    fetchUser()
  }, [])

  useEffect(() => {
    const fetchIdeas = async () => {
      if (!teamId) return

      try {
        setLoading(true)
        const { data: requests, error } = await supabase
          .from('feature_requests')
          .select('*')
          .eq('team_id', teamId)
          .order('vote_count', { ascending: false })
          .order('created_at', { ascending: false })

        if (error) throw error

        if (userId) {
          const { data: votes } = await supabase
            .from('feature_request_votes')
            .select('request_id')
            .eq('user_id', userId)

          const votedIds = new Set(votes?.map(v => v.request_id) || [])

          const enrichedRequests = (requests || []).map(req => ({
            ...req,
            attachments: Array.isArray(req.attachments) ? req.attachments : [],
            user_has_voted: votedIds.has(req.id),
          }))

          setIdeas(enrichedRequests)
        } else {
          setIdeas((requests || []).map(req => ({
            ...req,
            attachments: Array.isArray(req.attachments) ? req.attachments : [],
          })))
        }
      } catch (err) {
        console.error('Error fetching ideas:', err)
        toast.error('Failed to load ideas')
      } finally {
        setLoading(false)
      }
    }

    fetchIdeas()
  }, [userId, teamId])

  // Apply filters + sort
  const filteredIdeas = (() => {
    let result = [...ideas]

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        idea =>
          idea.title.toLowerCase().includes(q) ||
          idea.description.toLowerCase().includes(q) ||
          idea.author_name.toLowerCase().includes(q)
      )
    }

    if (selectedCategory) {
      result = result.filter(idea => idea.category === selectedCategory)
    }

    if (selectedStatus) {
      result = result.filter(idea => idea.status === selectedStatus)
    }

    // Sort
    switch (sortMode) {
      case 'newest':
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        break
      case 'oldest':
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        break
      default: // votes
        result.sort((a, b) => b.vote_count - a.vote_count || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }

    return result
  })()

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(f => {
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name} is too large (max 5MB)`)
        return false
      }
      return true
    })
    setPendingFiles(prev => [...prev, ...validFiles].slice(0, 3)) // Max 3 files
    if (e.target) e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  const uploadFiles = async (): Promise<Attachment[]> => {
    if (pendingFiles.length === 0) return []

    const attachments: Attachment[] = []

    for (const file of pendingFiles) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
      const filePath = `${teamId}/${fileName}`

      const { error } = await supabase.storage
        .from('idea-attachments')
        .upload(filePath, file)

      if (error) {
        console.error('Upload error:', error)
        // If storage bucket doesn't exist, store as data URL fallback
        if (error.message?.includes('not found') || error.message?.includes('bucket')) {
          // Skip this file silently — bucket not configured
          continue
        }
        toast.error(`Failed to upload ${file.name}`)
        continue
      }

      const { data: urlData } = supabase.storage
        .from('idea-attachments')
        .getPublicUrl(filePath)

      attachments.push({
        url: urlData.publicUrl,
        name: file.name,
        type: file.type,
        size: file.size,
      })
    }

    return attachments
  }

  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!userId) {
      toast.error('Please log in to submit an idea')
      return
    }

    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in title and description')
      return
    }

    try {
      setSubmitting(true)

      const attachments = await uploadFiles()

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
          team_id: teamId,
          attachments: attachments.length > 0 ? attachments : [],
        })
        .select()
        .single()

      if (error) throw error

      setTitle('')
      setDescription('')
      setCategory('Feature')
      setPendingFiles([])

      const enrichedRequest = {
        ...newRequest,
        attachments: attachments,
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

    // Optimistic update
    setIdeas(prev => prev.map(idea => {
      if (idea.id === ideaId) {
        return {
          ...idea,
          vote_count: hasVoted ? idea.vote_count - 1 : idea.vote_count + 1,
          user_has_voted: !hasVoted,
        }
      }
      return idea
    }))

    try {
      if (hasVoted) {
        const { error } = await supabase
          .from('feature_request_votes')
          .delete()
          .eq('request_id', ideaId)
          .eq('user_id', userId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('feature_request_votes')
          .insert({ request_id: ideaId, user_id: userId })
        if (error) throw error
      }
    } catch (err) {
      // Revert on error
      setIdeas(prev => prev.map(idea => {
        if (idea.id === ideaId) {
          return {
            ...idea,
            vote_count: hasVoted ? idea.vote_count + 1 : idea.vote_count - 1,
            user_has_voted: hasVoted,
          }
        }
        return idea
      }))
      console.error('Error voting:', err)
      toast.error('Failed to update vote')
    }
  }

  const formatTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
    return new Date(date).toLocaleDateString()
  }

  const isImage = (type: string) => type.startsWith('image/')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2" style={{ letterSpacing: '-0.025em' }}>
          <Lightbulb aria-hidden="true" className="w-8 h-8 text-indigo-600" />
          Feature Ideas
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Share your ideas to help shape HeyWren&apos;s future. Upvote the ideas you want most.
        </p>
      </div>

      {/* Submit Form */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Submit an Idea</h2>
        <form onSubmit={handleSubmitIdea} className="space-y-4">
          <div>
            <label htmlFor="idea-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
            <input
              id="idea-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's your idea?"
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition dark:bg-surface-dark dark:text-white"
              disabled={submitting}
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="idea-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <textarea
              id="idea-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your idea in detail..."
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none dark:bg-surface-dark dark:text-white"
              disabled={submitting}
              aria-required="true"
            />
          </div>

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Attachments <span className="text-gray-400 font-normal">(optional, max 3 files, 5MB each)</span>
              </label>
            </div>

            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
                    {isImage(file.type) ? (
                      <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                    )}
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[150px]">{file.name}</span>
                    <span className="text-[10px] text-gray-400">{(file.size / 1024).toFixed(0)}KB</span>
                    <button
                      type="button"
                      onClick={() => removePendingFile(i)}
                      className="text-gray-400 hover:text-red-500 transition"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {pendingFiles.length < 3 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                disabled={submitting}
              >
                <Paperclip className="w-4 h-4" />
                Add screenshot or file
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept="image/*,.pdf,.doc,.docx,.txt"
              className="hidden"
              multiple
            />
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="idea-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
              <select
                id="idea-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])}
                className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition dark:bg-surface-dark dark:text-white"
                disabled={submitting}
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting || !title.trim() || !description.trim()}
              className="px-6 py-2 text-white rounded-lg transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
              }}
            >
              <Send aria-hidden="true" className="w-4 h-4" />
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>

      {/* Filters + Sort */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ideas..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition dark:bg-surface-dark dark:text-white"
              />
            </div>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark-secondary dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="votes">Most Upvoted</option>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
            </select>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Filter aria-hidden="true" className="w-4 h-4 text-gray-400" />
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                selectedCategory === null
                  ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                  selectedCategory === cat
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />
            <button
              onClick={() => setSelectedStatus(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                selectedStatus === null
                  ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              All Status
            </button>
            {STATUSES.map(status => (
              <button
                key={status}
                onClick={() => setSelectedStatus(selectedStatus === status ? null : status)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                  selectedStatus === status
                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ideas count */}
      {!loading && filteredIdeas.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {filteredIdeas.length} idea{filteredIdeas.length !== 1 ? 's' : ''}
            {(selectedCategory || selectedStatus || searchQuery) && ` (filtered)`}
          </p>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <ArrowUpDown className="w-3 h-3" />
            {sortMode === 'votes' ? 'Sorted by upvotes' : sortMode === 'newest' ? 'Newest first' : 'Oldest first'}
          </div>
        </div>
      )}

      {/* Ideas List */}
      {loading ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading ideas">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 animate-pulse">
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-1 px-3 py-2 flex-shrink-0">
                  <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="w-6 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredIdeas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl">
          <Lightbulb className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            {searchQuery || selectedCategory || selectedStatus ? 'No ideas match your filters' : 'No ideas yet'}
          </p>
          <p className="text-gray-400 text-sm mt-1">
            {searchQuery || selectedCategory || selectedStatus ? 'Try adjusting your search or filters' : 'Be the first to share an idea!'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredIdeas.map((idea, rank) => {
            const categoryColor = CATEGORY_COLORS[idea.category] || CATEGORY_COLORS.Other
            const statusColor = STATUS_COLORS[idea.status] || STATUS_COLORS['Under Review']
            const attachments = Array.isArray(idea.attachments) ? idea.attachments : []

            return (
              <div
                key={idea.id}
                className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-sm transition"
              >
                <div className="flex gap-4">
                  {/* Upvote Button */}
                  <button
                    onClick={() => handleVote(idea.id, idea.user_has_voted || false)}
                    aria-label={idea.user_has_voted ? `Remove upvote from "${idea.title}"` : `Upvote "${idea.title}"`}
                    aria-pressed={idea.user_has_voted || false}
                    className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition flex-shrink-0 min-w-[52px] ${
                      idea.user_has_voted
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-300 dark:border-indigo-700'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-2 border-transparent hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400'
                    }`}
                  >
                    <ChevronUp className={`w-5 h-5 ${idea.user_has_voted ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                    <span className="text-sm font-bold">{idea.vote_count}</span>
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug">
                          {sortMode === 'votes' && rank < 3 && idea.vote_count > 0 && (
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white mr-1.5 ${
                              rank === 0 ? 'bg-amber-500' : rank === 1 ? 'bg-gray-400' : 'bg-amber-700'
                            }`}>
                              {rank + 1}
                            </span>
                          )}
                          {idea.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {idea.description}
                        </p>
                      </div>
                    </div>

                    {/* Attachments */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {attachments.map((att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg hover:border-indigo-300 dark:hover:border-indigo-700 transition text-xs"
                          >
                            {isImage(att.type) ? (
                              <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-gray-400" />
                            )}
                            <span className="text-gray-700 dark:text-gray-300 truncate max-w-[120px]">{att.name}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${categoryColor.bg} ${categoryColor.text}`}>
                        {idea.category}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusColor.bg} ${statusColor.text}`}>
                        {idea.status}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {idea.author_name} &middot; {formatTimeAgo(idea.created_at)}
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
