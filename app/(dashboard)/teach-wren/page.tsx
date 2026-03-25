'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  GraduationCap, Send, ChevronUp, Sparkles, CheckCircle2,
  Clock, XCircle, Copy, Search, Filter, ArrowUpDown, Zap,
  MessageSquare, Mail, AlertTriangle, Target, Users,
  Paperclip, X, Image as ImageIcon, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface Attachment {
  url: string
  name: string
  type: string
  size: number
}

interface CommunitySignal {
  id: string
  signal_type: string
  title: string
  description: string
  example_content: string | null
  expected_behavior: string
  source_platform: string | null
  validation_status: string
  validation_confidence: number | null
  validation_reason: string | null
  extracted_pattern: string | null
  attachments: Attachment[] | null
  vote_count: number
  author_name: string
  created_at: string
  user_has_voted: boolean
}

const SIGNAL_TYPES = [
  { value: 'missed_email', label: 'Missed Email', icon: Mail, desc: 'An email HeyWren should have flagged' },
  { value: 'missed_chat', label: 'Missed Chat', icon: MessageSquare, desc: 'A Slack message that should have been caught' },
  { value: 'wrong_priority', label: 'Wrong Priority', icon: AlertTriangle, desc: 'Detected but with wrong urgency' },
  { value: 'false_positive', label: 'False Positive', icon: XCircle, desc: 'Flagged but shouldn\'t have been' },
  { value: 'missing_pattern', label: 'Missing Pattern', icon: Target, desc: 'A pattern HeyWren doesn\'t recognize' },
  { value: 'other', label: 'Other', icon: Zap, desc: 'Something else entirely' },
] as const

const STATUS_DISPLAY: Record<string, { label: string; bg: string; text: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Under Review', bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400', icon: Clock },
  validated: { label: 'Validated', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', icon: CheckCircle2 },
  promoted: { label: 'Live in Algorithm', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', icon: Sparkles },
  rejected: { label: 'Not Actionable', bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', icon: XCircle },
  duplicate: { label: 'Duplicate', bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', icon: Copy },
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  missed_email: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400' },
  missed_chat: { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-400' },
  wrong_priority: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-400' },
  false_positive: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400' },
  missing_pattern: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', text: 'text-indigo-700 dark:text-indigo-400' },
  other: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400' },
}

type SortMode = 'votes' | 'newest'

export default function TeachWrenPage() {
  const supabase = createClient()

  const [signals, setSignals] = useState<CommunitySignal[]>([])
  const [patternCount, setPatternCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [signalType, setSignalType] = useState<string>('missed_email')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [exampleContent, setExampleContent] = useState('')
  const [expectedBehavior, setExpectedBehavior] = useState('')
  const [sourcePlatform, setSourcePlatform] = useState<string>('email')
  const [submitting, setSubmitting] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<SortMode>('votes')

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser()
      if (data?.user) {
        setUserId(data.user.id)
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', data.user.id)
          .single()
        if (profile?.current_team_id) setTeamId(profile.current_team_id)
      }
      await fetchSignals()
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchSignals = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.set('status', filterStatus)
      if (filterType) params.set('type', filterType)
      params.set('sort', sortMode)

      const res = await fetch(`/api/community-signals?${params}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setSignals(data.signals || [])
        setPatternCount(data.patternCount || 0)
      }
    } catch (err) {
      console.error('Failed to fetch signals:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!loading) fetchSignals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterStatus, sortMode])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(f => {
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name} is too large (max 5MB)`)
        return false
      }
      return true
    })
    setPendingFiles(prev => [...prev, ...validFiles].slice(0, 5))
    if (e.target) e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  const uploadFiles = async (): Promise<Attachment[]> => {
    if (pendingFiles.length === 0 || !teamId) return []
    const attachments: Attachment[] = []
    for (const file of pendingFiles) {
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`
      const filePath = `${teamId}/${fileName}`
      const { error } = await supabase.storage
        .from('signal-attachments')
        .upload(filePath, file)
      if (error) {
        console.error('Upload error:', error)
        if (error.message?.includes('not found') || error.message?.includes('bucket')) continue
        toast.error(`Failed to upload ${file.name}`)
        continue
      }
      const { data: urlData } = supabase.storage
        .from('signal-attachments')
        .getPublicUrl(filePath)
      attachments.push({ url: urlData.publicUrl, name: file.name, type: file.type, size: file.size })
    }
    return attachments
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !description.trim() || !expectedBehavior.trim()) {
      toast.error('Please fill in all required fields')
      return
    }

    setSubmitting(true)
    try {
      const attachments = await uploadFiles()

      const res = await fetch('/api/community-signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalType,
          title: title.trim(),
          description: description.trim(),
          exampleContent: exampleContent.trim() || null,
          expectedBehavior: expectedBehavior.trim(),
          sourcePlatform,
          attachments: attachments.length > 0 ? attachments : null,
        }),
      })

      if (res.ok) {
        toast.success('Signal submitted! AI is reviewing it now...')
        setTitle('')
        setDescription('')
        setExampleContent('')
        setExpectedBehavior('')
        setPendingFiles([])
        setShowForm(false)
        await fetchSignals()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to submit')
      }
    } catch {
      toast.error('Failed to submit signal')
    }
    setSubmitting(false)
  }

  const handleVote = async (signalId: string, hasVoted: boolean) => {
    // Optimistic update
    setSignals(prev => prev.map(s =>
      s.id === signalId
        ? { ...s, user_has_voted: !hasVoted, vote_count: s.vote_count + (hasVoted ? -1 : 1) }
        : s
    ))

    try {
      await fetch('/api/community-signals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalId, action: hasVoted ? 'unvote' : 'vote' }),
      })
    } catch {
      // Revert on error
      setSignals(prev => prev.map(s =>
        s.id === signalId
          ? { ...s, user_has_voted: hasVoted, vote_count: s.vote_count + (hasVoted ? 1 : -1) }
          : s
      ))
    }
  }

  const filteredSignals = signals.filter(s => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    }
    return true
  })

  const promotedCount = signals.filter(s => s.validation_status === 'promoted').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Teach Wren</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/30 dark:to-violet-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800/50">
              <Users className="w-3 h-3" />
              Community
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Show Wren what it missed. Your examples train the AI for everyone.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-white font-semibold text-sm rounded-lg transition-all"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
          }}
        >
          <GraduationCap className="w-4 h-4" />
          Teach Wren Something
        </button>
      </div>

      {/* Stats Banner */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/20 dark:to-violet-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-indigo-900 dark:text-indigo-200">Community-Powered Intelligence</p>
            <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
              When you submit an example, AI validates it and extracts a detection pattern. High-confidence patterns are
              automatically added to the algorithm — making HeyWren smarter for every user.
            </p>
            <div className="flex items-center gap-6 mt-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-200">{patternCount}</p>
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">Live Patterns</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-900 dark:text-indigo-200">{signals.length}</p>
                <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">Signals Submitted</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">{promotedCount}</p>
                <p className="text-[11px] text-green-600 dark:text-green-400 font-medium">Promoted to Algorithm</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Submit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Submit a Signal</h2>
          </div>

          {/* Signal Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">What happened?</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {SIGNAL_TYPES.map(({ value, label, icon: Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSignalType(value)}
                  className={`flex items-start gap-2 p-3 rounded-lg border-2 text-left transition-all ${
                    signalType === value
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-gray-200 dark:border-border-dark hover:border-gray-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${signalType === value ? 'text-indigo-600' : 'text-gray-400'}`} />
                  <div>
                    <p className={`text-sm font-medium ${signalType === value ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-700 dark:text-gray-300'}`}>{label}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Vendor follow-up not flagged as urgent"
              className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              maxLength={200}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What happened? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the situation in detail. Who sent the message? What was the context? Why was it important?"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Example Content (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Example message/email (optional)
            </label>
            <textarea
              value={exampleContent}
              onChange={(e) => setExampleContent(e.target.value)}
              placeholder="Paste the actual message or email content that was missed (redact sensitive info)"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-xs"
            />
          </div>

          {/* Expected Behavior */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What should HeyWren have done? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={expectedBehavior}
              onChange={(e) => setExpectedBehavior(e.target.value)}
              placeholder="e.g. Should have flagged as HIGH urgency with same-day expected response time. The vendor was checking on performance and requesting a meeting — this clearly needs a prompt reply."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Attachments (optional)
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Screenshots, emails, or documents that show what HeyWren missed. Max 5 files, 5MB each.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.eml"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pendingFiles.length >= 5}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-border-dark rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition disabled:opacity-50"
            >
              <Paperclip className="w-4 h-4" />
              Attach files
            </button>

            {pendingFiles.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-white/5 rounded-lg">
                    {file.type.startsWith('image/') ? (
                      <ImageIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{file.name}</span>
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
          </div>

          {/* Platform */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Platform</label>
            <div className="flex gap-2">
              {['email', 'slack', 'teams', 'other'].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSourcePlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                    sourcePlatform === p
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700'
                      : 'border-gray-200 dark:border-border-dark text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !description.trim() || !expectedBehavior.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-white font-semibold text-sm rounded-lg transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
              }}
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting...' : 'Submit Signal'}
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search signals..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark"
          />
        </div>

        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={filterType || ''}
            onChange={(e) => setFilterType(e.target.value || null)}
            className="px-2 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-xs bg-white dark:bg-surface-dark text-gray-600"
          >
            <option value="">All types</option>
            {SIGNAL_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <select
          value={filterStatus || ''}
          onChange={(e) => setFilterStatus(e.target.value || null)}
          className="px-2 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-xs bg-white dark:bg-surface-dark text-gray-600"
        >
          <option value="">All statuses</option>
          <option value="pending">Under Review</option>
          <option value="validated">Validated</option>
          <option value="promoted">Live in Algorithm</option>
        </select>

        <button
          onClick={() => setSortMode(sortMode === 'votes' ? 'newest' : 'votes')}
          className="inline-flex items-center gap-1 px-2 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-xs text-gray-600 hover:bg-gray-50"
        >
          <ArrowUpDown className="w-3 h-3" />
          {sortMode === 'votes' ? 'Top voted' : 'Newest'}
        </button>
      </div>

      {/* Signal List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5 animate-pulse">
              <div className="h-4 w-1/3 bg-gray-200 rounded mb-3" />
              <div className="h-3 w-2/3 bg-gray-100 rounded mb-2" />
              <div className="h-3 w-1/2 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : filteredSignals.length === 0 ? (
        <div className="text-center py-16">
          <GraduationCap className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">No signals yet</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Be the first to teach Wren something new. Submit an example of something it missed and help make the algorithm smarter for everyone.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-indigo-600 font-medium text-sm hover:bg-indigo-50 rounded-lg transition"
          >
            <Send className="w-4 h-4" />
            Submit your first signal
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSignals.map(signal => {
            const status = STATUS_DISPLAY[signal.validation_status] || STATUS_DISPLAY.pending
            const typeColor = TYPE_COLORS[signal.signal_type] || TYPE_COLORS.other
            const StatusIcon = status.icon

            return (
              <div
                key={signal.id}
                className={`bg-white dark:bg-surface-dark-secondary border rounded-xl p-5 transition-all ${
                  signal.validation_status === 'promoted'
                    ? 'border-green-200 dark:border-green-800/50'
                    : 'border-gray-200 dark:border-border-dark'
                }`}
              >
                <div className="flex gap-4">
                  {/* Vote button */}
                  <button
                    onClick={() => handleVote(signal.id, signal.user_has_voted)}
                    className={`flex flex-col items-center gap-0.5 pt-1 ${
                      signal.user_has_voted
                        ? 'text-indigo-600'
                        : 'text-gray-400 hover:text-indigo-500'
                    }`}
                  >
                    <ChevronUp className={`w-5 h-5 ${signal.user_has_voted ? 'fill-current' : ''}`} />
                    <span className="text-sm font-bold">{signal.vote_count}</span>
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{signal.title}</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${typeColor.bg} ${typeColor.text}`}>
                        {SIGNAL_TYPES.find(t => t.value === signal.signal_type)?.label || signal.signal_type}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${status.bg} ${status.text}`}>
                        <StatusIcon className="w-3 h-3" />
                        {status.label}
                      </span>
                    </div>

                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{signal.description}</p>

                    {/* Extracted pattern (if validated/promoted) */}
                    {signal.extracted_pattern && (
                      <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/30 rounded-lg">
                        <Sparkles className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-green-800 dark:text-green-300">
                          <span className="font-semibold">Pattern extracted:</span> {signal.extracted_pattern}
                        </p>
                      </div>
                    )}

                    {/* Validation reason */}
                    {signal.validation_reason && signal.validation_status !== 'pending' && (
                      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 italic">
                        AI: {signal.validation_reason}
                      </p>
                    )}

                    {/* Attachments */}
                    {signal.attachments && signal.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {signal.attachments.map((att, i) => (
                          <a
                            key={i}
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100 dark:bg-white/5 rounded text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10 transition"
                          >
                            {att.type?.startsWith('image/') ? (
                              <ImageIcon className="w-3 h-3 text-blue-500" />
                            ) : (
                              <FileText className="w-3 h-3 text-gray-400" />
                            )}
                            <span className="truncate max-w-[120px]">{att.name}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>{signal.author_name}</span>
                      <span>{new Date(signal.created_at).toLocaleDateString()}</span>
                      {signal.source_platform && (
                        <span className="capitalize">{signal.source_platform}</span>
                      )}
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
