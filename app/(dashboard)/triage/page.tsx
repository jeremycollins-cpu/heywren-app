'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CheckCircle2, Clock, X, ArrowRight, SkipForward, AlertTriangle,
  Hash, Mail, Calendar, PenLine, ExternalLink, ChevronRight,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface CommitmentMetadata {
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  commitmentType?: 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'
  originalQuote?: string
  channelName?: string
  stakeholders?: Array<{ name: string; role: string }>
  direction?: 'inbound' | 'outbound'
}

interface Commitment {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_url: string | null
  metadata: CommitmentMetadata | null
  creator_id: string | null
  assignee_id: string | null
  category: string | null
  due_date: string | null
  priority_score: number
  created_at: string
  updated_at: string
}

type TriageAction = 'kept' | 'snoozed' | 'dropped' | 'skipped'

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function getUrgencyColor(commitment: Commitment): string {
  if (commitment.status === 'overdue') return 'border-l-red-500'
  const urgency = commitment.metadata?.urgency
  if (urgency === 'critical') return 'border-l-red-500'
  if (urgency === 'high') return 'border-l-amber-500'
  if (urgency === 'medium') return 'border-l-indigo-500'
  return 'border-l-gray-300 dark:border-l-gray-600'
}

function getSourceInfo(source: string | null) {
  switch (source) {
    case 'slack': return { label: 'Slack', icon: Hash, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400' }
    case 'outlook': case 'email': return { label: 'Email', icon: Mail, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' }
    case 'meeting': case 'calendar': return { label: 'Meeting', icon: Calendar, color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' }
    default: return { label: 'Manual', icon: PenLine, color: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400' }
  }
}

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 Days', days: 3 },
  { label: 'Next Week', days: 7 },
  { label: 'Next Month', days: 30 },
]

export default function TriagePage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showSnooze, setShowSnooze] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [sessionLog, setSessionLog] = useState<TriageAction[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) { setLoading(false); return }

        setUserId(userData.user.id)

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        if (!profile?.current_team_id) { setLoading(false); return }

        const { data, error: fetchError } = await supabase
          .from('commitments')
          .select('*')
          .eq('team_id', profile.current_team_id)
          .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
          .in('status', ['open', 'overdue'])
          .is('deleted_at', null)
          .order('status', { ascending: true })
          .order('priority_score', { ascending: false })
          .order('created_at', { ascending: true })

        if (fetchError) throw fetchError
        setCommitments(data || [])
      } catch (err) {
        console.error('Error loading triage items:', err)
        setError(err instanceof Error ? err.message : 'Failed to load commitments')
        toast.error('Failed to load triage items')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const advance = useCallback((action: TriageAction) => {
    setSessionLog(prev => [...prev, action])
    setTransitioning(true)
    setTimeout(() => {
      setCurrentIndex(prev => prev + 1)
      setShowSnooze(false)
      setTransitioning(false)
    }, 200)
  }, [])

  const handleKeep = useCallback(async () => {
    const item = commitments[currentIndex]
    if (!item) return

    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', item.id)

    if (error) {
      toast.error('Failed to update commitment')
      return
    }
    toast.success('Kept — marked in progress')
    advance('kept')
  }, [commitments, currentIndex, advance])

  const handleSnooze = useCallback(async (days: number) => {
    const item = commitments[currentIndex]
    if (!item) return

    const newDate = new Date()
    newDate.setDate(newDate.getDate() + days)

    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ due_date: newDate.toISOString(), status: 'open', updated_at: new Date().toISOString() })
      .eq('id', item.id)

    if (error) {
      toast.error('Failed to snooze')
      return
    }
    toast.success(`Snoozed for ${days} day${days !== 1 ? 's' : ''}`)
    advance('snoozed')
  }, [commitments, currentIndex, advance])

  const handleDrop = useCallback(async () => {
    const item = commitments[currentIndex]
    if (!item) return

    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'dropped', updated_at: new Date().toISOString() })
      .eq('id', item.id)

    if (error) {
      toast.error('Failed to drop commitment')
      return
    }
    toast.success('Dropped')
    advance('dropped')
  }, [commitments, currentIndex, advance])

  const handleSkip = useCallback(() => {
    advance('skipped')
  }, [advance])

  // Keyboard shortcuts
  useEffect(() => {
    if (currentIndex >= commitments.length || showSnooze) return

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      switch (e.key.toLowerCase()) {
        case 'k': handleKeep(); break
        case 's': setShowSnooze(true); break
        case 'x': handleDrop(); break
        case 'arrowright': handleSkip(); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, commitments.length, showSnooze, handleKeep, handleDrop, handleSkip])

  // Snooze keyboard shortcuts
  useEffect(() => {
    if (!showSnooze) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowSnooze(false); return }
      const num = parseInt(e.key)
      if (num >= 1 && num <= SNOOZE_OPTIONS.length) {
        handleSnooze(SNOOZE_OPTIONS[num - 1].days)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSnooze, handleSnooze])

  // Swipe gesture handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setSwipeDirection(null)
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    setSwipeDirection(null)

    // Only register horizontal swipes (ignore vertical scrolling)
    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx)) return

    if (dx > 0) handleKeep()    // Swipe right = Keep
    else handleDrop()            // Swipe left = Drop
  }, [handleKeep, handleDrop])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.touches[0].clientX - touchStartRef.current.x
    if (dx > 40) setSwipeDirection('right')
    else if (dx < -40) setSwipeDirection('left')
    else setSwipeDirection(null)
  }, [])

  if (loading) return <LoadingSkeleton variant="card" />

  const isComplete = currentIndex >= commitments.length
  const current = commitments[currentIndex]
  const keptCount = sessionLog.filter(a => a === 'kept').length
  const snoozedCount = sessionLog.filter(a => a === 'snoozed').length
  const droppedCount = sessionLog.filter(a => a === 'dropped').length
  const skippedCount = sessionLog.filter(a => a === 'skipped').length

  return (
    <UpgradeGate featureKey="triage">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Triage</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Quickly process your commitments — one at a time, keyboard-driven
          </p>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
            <span className="text-sm font-medium">{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
          </div>
        )}

        {/* Progress bar */}
        {commitments.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {isComplete ? 'All done!' : `${currentIndex + 1} of ${commitments.length}`}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {keptCount} kept · {snoozedCount} snoozed · {droppedCount} dropped
              </span>
            </div>
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${commitments.length > 0 ? (currentIndex / commitments.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Empty state */}
        {commitments.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Inbox zero!</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              You have no open or overdue commitments to triage. Check back later as new commitments come in.
            </p>
          </div>
        )}

        {/* Session complete summary */}
        {isComplete && commitments.length > 0 && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Triage Complete</h2>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                You processed {sessionLog.length} commitment{sessionLog.length !== 1 ? 's' : ''} this session.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-600">{keptCount}</p>
                  <p className="text-xs text-green-700 dark:text-green-400 font-medium">Kept</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                  <p className="text-2xl font-bold text-amber-600">{snoozedCount}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Snoozed</p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-600">{droppedCount}</p>
                  <p className="text-xs text-red-700 dark:text-red-400 font-medium">Dropped</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <p className="text-2xl font-bold text-gray-600 dark:text-gray-300">{skippedCount}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">Skipped</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Current commitment card */}
        {current && !isComplete && (
          <div
            className={`max-w-2xl mx-auto transition-all duration-200 relative ${transitioning ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Swipe indicator overlay */}
            {swipeDirection && (
              <div className={`absolute inset-0 z-10 flex items-center justify-center pointer-events-none ${
                swipeDirection === 'right' ? 'text-green-500' : 'text-red-500'
              }`}>
                <span className="text-lg font-bold bg-white/90 dark:bg-gray-900/90 px-4 py-2 rounded-full shadow-lg">
                  {swipeDirection === 'right' ? 'Keep' : 'Drop'}
                </span>
              </div>
            )}
            <div className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl shadow-sm overflow-hidden border-l-4 ${getUrgencyColor(current)} ${
              swipeDirection === 'right' ? 'ring-2 ring-green-400' : swipeDirection === 'left' ? 'ring-2 ring-red-400' : ''
            }`}>
              <div className="p-6 space-y-4">
                {/* Header badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  {current.status === 'overdue' && (
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                      <AlertTriangle aria-hidden="true" className="w-3 h-3" /> Overdue
                    </span>
                  )}
                  {(() => {
                    const src = getSourceInfo(current.source)
                    const Icon = src.icon
                    return (
                      <span className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${src.color}`}>
                        <Icon aria-hidden="true" className="w-3 h-3" /> {src.label}
                      </span>
                    )
                  })()}
                  {current.metadata?.channelName && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">#{current.metadata.channelName}</span>
                  )}
                  {current.category && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
                      {current.category}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">{timeAgo(current.created_at)}</span>
                </div>

                {/* Title */}
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white leading-snug">
                  {current.title}
                </h3>

                {/* Direction */}
                {current.metadata?.direction && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {current.metadata.direction === 'outbound' ? 'You committed to this' : 'Someone committed this to you'}
                  </p>
                )}

                {/* Description */}
                {current.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{current.description}</p>
                )}

                {/* Original quote */}
                {current.metadata?.originalQuote && (
                  <blockquote className="border-l-2 border-indigo-300 dark:border-indigo-600 pl-3 py-1 text-sm text-gray-500 dark:text-gray-400 italic">
                    &ldquo;{current.metadata.originalQuote}&rdquo;
                  </blockquote>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap text-xs text-gray-400 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-700">
                  {current.due_date && (
                    <span className="flex items-center gap-1">
                      <Clock aria-hidden="true" className="w-3.5 h-3.5" />
                      Due {new Date(current.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {current.priority_score > 0 && (
                    <span>Priority: {Math.round(current.priority_score)}</span>
                  )}
                  {current.metadata?.stakeholders && current.metadata.stakeholders.length > 0 && (
                    <span>{current.metadata.stakeholders.map(s => s.name).join(', ')}</span>
                  )}
                  {current.source_url && (
                    <a
                      href={current.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 transition ml-auto"
                    >
                      View source <ExternalLink aria-hidden="true" className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Action bar */}
              <div className="bg-gray-50 dark:bg-surface-dark px-6 py-4">
                {showSnooze ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Snooze for:</p>
                    <div className="flex flex-wrap gap-2">
                      {SNOOZE_OPTIONS.map((opt, i) => (
                        <button
                          key={opt.label}
                          onClick={() => handleSnooze(opt.days)}
                          className="px-4 py-2 bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:border-amber-300 dark:hover:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                        >
                          {opt.label} <span className="text-xs text-gray-400 ml-1">[{i + 1}]</span>
                        </button>
                      ))}
                      <button
                        onClick={() => setShowSnooze(false)}
                        className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition"
                      >
                        Cancel <span className="text-xs text-gray-400 ml-1">[Esc]</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2 sm:flex sm:items-center sm:gap-2">
                    <button
                      onClick={handleKeep}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 sm:py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 active:bg-green-800 transition text-sm font-medium"
                      aria-label="Keep commitment"
                    >
                      <CheckCircle2 aria-hidden="true" className="w-4 h-4" />
                      <span>Keep</span>
                      <kbd className="hidden sm:inline ml-1 text-[10px] px-1.5 py-0.5 bg-green-700 rounded font-mono">K</kbd>
                    </button>
                    <button
                      onClick={() => setShowSnooze(true)}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 sm:py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 transition text-sm font-medium"
                      aria-label="Snooze commitment"
                    >
                      <Clock aria-hidden="true" className="w-4 h-4" />
                      <span>Snooze</span>
                      <kbd className="hidden sm:inline ml-1 text-[10px] px-1.5 py-0.5 bg-amber-600 rounded font-mono">S</kbd>
                    </button>
                    <button
                      onClick={handleDrop}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 sm:py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 active:bg-red-700 transition text-sm font-medium"
                      aria-label="Drop commitment"
                    >
                      <X aria-hidden="true" className="w-4 h-4" />
                      <span>Drop</span>
                      <kbd className="hidden sm:inline ml-1 text-[10px] px-1.5 py-0.5 bg-red-600 rounded font-mono">X</kbd>
                    </button>
                    <button
                      onClick={handleSkip}
                      className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 sm:py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 active:bg-gray-400 transition text-sm font-medium"
                      aria-label="Skip to next"
                    >
                      <span>Skip</span>
                      <ArrowRight aria-hidden="true" className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Desktop: keyboard hints */}
            <p className="hidden sm:block text-center text-xs text-gray-400 dark:text-gray-500 mt-3">
              Keyboard shortcuts: <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-mono">K</kbd> Keep &middot;
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-mono ml-1">S</kbd> Snooze &middot;
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-mono ml-1">X</kbd> Drop &middot;
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-mono ml-1">&rarr;</kbd> Skip
            </p>
            {/* Mobile: swipe hint */}
            <p className="sm:hidden text-center text-xs text-gray-400 dark:text-gray-500 mt-3">
              Swipe right to keep &middot; Swipe left to drop
            </p>
          </div>
        )}
      </div>
    </UpgradeGate>
  )
}
