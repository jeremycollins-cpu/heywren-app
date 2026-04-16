// app/(dashboard)/commitments/[id]/page.tsx
// Commitment Detail Page — view, edit, and track a single commitment

'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRealtime } from '@/lib/hooks/use-realtime'
import { safeHref } from '@/lib/url/safe-href'
import toast from 'react-hot-toast'
import {
  ArrowLeft, CheckCircle2, Clock, AlertTriangle, Hash,
  Mail, Calendar, Edit2, Save, X, User, Users, MessageSquare,
  ExternalLink,
} from 'lucide-react'

interface CommitmentStakeholder {
  name: string
  role: 'owner' | 'assignee' | 'stakeholder'
}

interface CommitmentMetadata {
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  tone?: 'casual' | 'professional' | 'urgent' | 'demanding'
  commitmentType?: 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'
  stakeholders?: CommitmentStakeholder[]
  originalQuote?: string
  channelName?: string
  confidence?: number
}

interface NudgeRecord {
  id: string
  message: string
  status: string
  created_at: string
  sent_at: string | null
}

interface CommitmentDetail {
  id: string
  title: string
  description: string | null
  status: string
  source: string | null
  source_ref: string | null
  source_url: string | null
  metadata: CommitmentMetadata | null
  creator_id: string | null
  assignee_id: string | null
  created_at: string
  updated_at: string
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function getStatusConfig(status: string, createdAt: string) {
  if (status === 'completed') return { label: 'Completed', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30', icon: CheckCircle2 }
  if (status === 'likely_complete') return { label: 'Likely Done', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/30', icon: CheckCircle2 }
  if (status === 'overdue') return { label: 'Overdue', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30', icon: AlertTriangle }
  if (status === 'dismissed') return { label: 'Dismissed', color: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800', icon: X }
  const age = daysSince(createdAt)
  if (age > 7) return { label: 'At Risk', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30', icon: AlertTriangle }
  if (age > 3) return { label: 'Stalled', color: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900/30', icon: Clock }
  return { label: 'Active', color: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30', icon: CheckCircle2 }
}

function getSourceIcon(source: string | null) {
  switch (source) {
    case 'slack': return { icon: Hash, label: 'Slack', color: 'text-purple-600' }
    case 'outlook': case 'email': return { icon: Mail, label: 'Email', color: 'text-blue-600' }
    case 'meeting': case 'calendar': return { icon: Calendar, label: 'Meeting', color: 'text-orange-600' }
    default: return { icon: Edit2, label: 'Manual', color: 'text-gray-500' }
  }
}

export default function CommitmentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [commitment, setCommitment] = useState<CommitmentDetail | null>(null)
  const [nudges, setNudges] = useState<NudgeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()

        // Get the authenticated user and their profile for ownership checks
        const { data: userData, error: authError } = await supabase.auth.getUser()
        if (authError || !userData?.user) {
          toast.error('Not authenticated')
          router.push('/commitments')
          return
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id, display_name')
          .eq('id', userData.user.id)
          .single()

        let teamId = profile?.current_team_id
        const userName = profile?.display_name || ''

        // Fallback team lookup if current_team_id is null
        if (!teamId) {
          const { data: membership } = await supabase.from('team_members').select('team_id').eq('user_id', userData.user.id).limit(1).single()
          teamId = membership?.team_id || null
        }
        if (!teamId) {
          const { data: orgMembership } = await supabase.from('organization_members').select('team_id').eq('user_id', userData.user.id).limit(1).single()
          teamId = orgMembership?.team_id || null
        }

        const [commitResult, nudgeResult] = await Promise.all([
          supabase.from('commitments').select('*').eq('id', id).single(),
          teamId
            ? supabase.from('nudges').select('*').eq('commitment_id', id).eq('team_id', teamId).order('created_at', { ascending: false }).limit(20)
            : Promise.resolve({ data: [], error: null }),
        ])
        if (commitResult.error) throw commitResult.error

        // Ownership check: user must be creator, assignee, or a stakeholder
        const data = commitResult.data
        if (data.creator_id !== userData.user.id && data.assignee_id !== userData.user.id) {
          const stakeholders = data.metadata?.stakeholders || []
          const isStakeholder = stakeholders.some((s: CommitmentStakeholder) => s.name?.toLowerCase().includes(userName.toLowerCase()))
          if (!isStakeholder) {
            setError('Commitment not found')
            setLoading(false)
            return
          }
        }

        setCommitment(data)
        setEditTitle(data.title)
        setEditDescription(data.description || '')
        setNudges(nudgeResult.data || [])
      } catch {
        toast.error('Commitment not found')
        router.push('/commitments')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, router])

  // Real-time updates for this specific commitment
  useRealtime({
    table: 'commitments',
    filter: `id=eq.${id}`,
    enabled: !loading,
    onUpdate: (payload) => {
      setCommitment(prev => prev ? { ...prev, ...payload.new } : prev)
    },
  })

  useRealtime({
    table: 'nudges',
    filter: `commitment_id=eq.${id}`,
    enabled: !loading,
    onInsert: (payload) => {
      setNudges(prev => [payload.new as NudgeRecord, ...prev])
    },
  })

  async function handleSave() {
    if (!commitment) return
    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('commitments').update({
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      }).eq('id', commitment.id)
      if (error) throw error
      setCommitment(prev => prev ? { ...prev, title: editTitle.trim(), description: editDescription.trim() || null } : prev)
      setEditing(false)
      toast.success('Commitment updated')
    } catch {
      toast.error('Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!commitment) return
    try {
      const supabase = createClient()
      const { error } = await supabase.from('commitments').update({ status: newStatus }).eq('id', commitment.id)
      if (error) throw error
      setCommitment(prev => prev ? { ...prev, status: newStatus } : prev)
      toast.success(`Marked as ${newStatus}`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-8 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto text-center">
        <p className="text-gray-500 dark:text-gray-400">{error}</p>
        <Link href="/commitments" className="text-indigo-500 hover:text-indigo-600 text-sm mt-2 inline-block">
          Back to commitments
        </Link>
      </div>
    )
  }

  if (!commitment) return null

  const statusConfig = getStatusConfig(commitment.status, commitment.created_at)
  const StatusIcon = statusConfig.icon
  const sourceInfo = getSourceIcon(commitment.source)
  const SourceIcon = sourceInfo.icon
  const meta = commitment.metadata
  const age = daysSince(commitment.created_at)
  const isOpen = !['completed', 'likely_complete', 'dismissed'].includes(commitment.status)

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-4 sm:space-y-6 animate-fade-in-up">
      {/* Back link */}
      <Link
        href="/commitments"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to commitments
      </Link>

      {/* Header */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full text-xl font-bold bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={3}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving || !editTitle.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditing(false); setEditTitle(commitment.title); setEditDescription(commitment.description || '') }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{commitment.title}</h1>
                {commitment.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{commitment.description}</p>
                )}
              </>
            )}
          </div>

          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Edit commitment"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.color}`}>
            <StatusIcon className="w-3 h-3" /> {statusConfig.label}
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 ${sourceInfo.color}`}>
            <SourceIcon className="w-3 h-3" /> {sourceInfo.label}
          </span>
          {meta?.urgency && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              meta.urgency === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
              meta.urgency === 'high' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
              meta.urgency === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
              'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
            }`}>
              {meta.urgency.charAt(0).toUpperCase() + meta.urgency.slice(1)} urgency
            </span>
          )}
          {meta?.commitmentType && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
              {meta.commitmentType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          )}
          {meta?.confidence !== undefined && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {Math.round(meta.confidence * 100)}% confidence
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {isOpen && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleStatusChange('completed')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" /> Mark Complete
          </button>
          <button
            onClick={() => {
              const supabase = createClient()
              const now = new Date().toISOString()
              supabase.from('commitments').update({ updated_at: now }).eq('id', commitment.id).then(() => {
                setCommitment(prev => prev ? { ...prev, updated_at: now } : prev)
                toast.success('Snoozed — timer reset')
              })
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Clock className="w-4 h-4" /> Snooze
          </button>
          <button
            onClick={() => handleStatusChange('dismissed')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" /> Dismiss
          </button>
        </div>
      )}

      {/* Details grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Timeline */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Timeline</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
              <div>
                <span className="text-gray-500 dark:text-gray-400">Detected</span>
                <span className="ml-2 text-gray-900 dark:text-white font-medium">{formatDate(commitment.created_at)}</span>
              </div>
            </div>
            {commitment.updated_at !== commitment.created_at && (
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Last updated</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{formatDate(commitment.updated_at)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 text-sm">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${age > 7 ? 'bg-red-500' : age > 3 ? 'bg-yellow-500' : 'bg-green-500'}`} />
              <div>
                <span className="text-gray-500 dark:text-gray-400">Age</span>
                <span className={`ml-2 font-medium ${age > 7 ? 'text-red-600 dark:text-red-400' : age > 3 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                  {age === 0 ? 'Today' : age === 1 ? '1 day' : `${age} days`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stakeholders */}
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">People</h3>
          {meta?.stakeholders && meta.stakeholders.length > 0 ? (
            <div className="space-y-2">
              {meta.stakeholders.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                    {s.role === 'owner' ? <User className="w-3.5 h-3.5 text-indigo-600" /> : <Users className="w-3.5 h-3.5 text-indigo-600" />}
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium">{s.name}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 capitalize">{s.role}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">No stakeholders detected</p>
          )}
        </div>
      </div>

      {/* Original quote */}
      {meta?.originalQuote && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Original Message</h3>
          <blockquote className="border-l-3 border-indigo-400 pl-4 py-2 text-sm text-gray-600 dark:text-gray-300 italic bg-gray-50 dark:bg-gray-800/50 rounded-r-lg pr-4">
            &ldquo;{meta.originalQuote}&rdquo;
          </blockquote>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
            {meta.channelName && (
              <span className="inline-flex items-center gap-1"><Hash className="w-3 h-3" />{meta.channelName}</span>
            )}
            {commitment.source_url && (
              <a href={safeHref(commitment.source_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-500 hover:text-indigo-600">
                <ExternalLink className="w-3 h-3" /> View in {sourceInfo.label}
              </a>
            )}
          </div>
        </div>
      )}

      {/* Nudge history */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          <MessageSquare className="w-4 h-4 inline mr-1.5" />
          Nudge History {nudges.length > 0 && <span className="text-gray-400 font-normal">({nudges.length})</span>}
        </h3>
        {nudges.length > 0 ? (
          <div className="space-y-3">
            {nudges.map(nudge => (
              <div key={nudge.id} className="flex items-start gap-3 text-sm">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  nudge.status === 'sent' ? 'bg-green-500' : nudge.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <div className="min-w-0">
                  <p className="text-gray-700 dark:text-gray-300">{nudge.message}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {nudge.status === 'sent' && nudge.sent_at ? `Sent ${formatDate(nudge.sent_at)}` : `${nudge.status} — ${formatDate(nudge.created_at)}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">No nudges sent yet</p>
        )}
      </div>
    </div>
  )
}
