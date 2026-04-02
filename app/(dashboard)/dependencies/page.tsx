'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, ExternalLink,
  AlertTriangle, Link2,
} from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface CommitmentMetadata {
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  direction?: 'inbound' | 'outbound'
  stakeholders?: Array<{ name: string; role: string }>
  channelName?: string
  originalQuote?: string
}

interface Commitment {
  id: string
  title: string
  status: string
  source: string | null
  source_url: string | null
  due_date: string | null
  created_at: string
  completed_at: string | null
  priority_score: number
  creator_id: string | null
  assignee_id: string | null
  metadata: CommitmentMetadata | null
}

interface PersonGroup {
  name: string
  commitments: Commitment[]
  overdueCount: number
  urgency: 'overdue' | 'due_soon' | 'on_track'
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function daysUntil(dateStr: string): number {
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function timeAgo(dateStr: string): string {
  const days = daysSince(dateStr)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function getAgingStatus(c: Commitment): { color: string; pulse: boolean; label: string } {
  if (c.status === 'overdue') return { color: 'bg-red-500', pulse: true, label: 'Overdue' }
  if (c.due_date) {
    const until = daysUntil(c.due_date)
    if (until < 0) return { color: 'bg-red-500', pulse: true, label: 'Overdue' }
    if (until <= 2) return { color: 'bg-amber-500', pulse: false, label: 'Due soon' }
    return { color: 'bg-green-500', pulse: false, label: 'On track' }
  }
  const age = daysSince(c.created_at)
  if (age > 7) return { color: 'bg-red-500', pulse: false, label: 'Stale' }
  if (age > 5) return { color: 'bg-amber-500', pulse: false, label: 'Aging' }
  return { color: 'bg-green-500', pulse: false, label: 'On track' }
}

function getPersonName(c: Commitment, isOutbound: boolean): string | null {
  const stakeholders = c.metadata?.stakeholders
  if (stakeholders && stakeholders.length > 0) {
    if (isOutbound) {
      const assignee = stakeholders.find(s => s.role === 'assignee' || s.role === 'stakeholder')
      if (assignee) return assignee.name
    } else {
      const owner = stakeholders.find(s => s.role === 'owner')
      if (owner) return owner.name
    }
    return stakeholders[0].name
  }
  return null
}

function groupByPerson(commitments: Commitment[], isOutbound: boolean): PersonGroup[] {
  const map = new Map<string, Commitment[]>()

  commitments.forEach(c => {
    const name = getPersonName(c, isOutbound) || c.title
    if (!map.has(name)) map.set(name, [])
    map.get(name)!.push(c)
  })

  const groups: PersonGroup[] = Array.from(map.entries()).map(([name, items]) => {
    const overdueCount = items.filter(c => c.status === 'overdue' || (c.due_date && daysUntil(c.due_date) < 0)).length
    const dueSoonCount = items.filter(c => c.due_date && daysUntil(c.due_date) >= 0 && daysUntil(c.due_date) <= 2).length
    let urgency: 'overdue' | 'due_soon' | 'on_track' = 'on_track'
    if (overdueCount > 0) urgency = 'overdue'
    else if (dueSoonCount > 0) urgency = 'due_soon'
    return { name, commitments: items, overdueCount, urgency }
  })

  groups.sort((a, b) => {
    const urgencyOrder = { overdue: 0, due_soon: 1, on_track: 2 }
    if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) return urgencyOrder[a.urgency] - urgencyOrder[b.urgency]
    return b.commitments.length - a.commitments.length
  })

  return groups
}

function urgencyBorderColor(urgency: string): string {
  if (urgency === 'overdue') return 'border-l-red-500'
  if (urgency === 'due_soon') return 'border-l-amber-500'
  return 'border-l-green-500'
}

function CommitmentRow({ c, onComplete, showCompleteButton }: { c: Commitment; onComplete: (id: string) => void; showCompleteButton: boolean }) {
  const aging = getAgingStatus(c)
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${aging.color} ${aging.pulse ? 'animate-pulse' : ''}`} title={aging.label} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{c.title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {c.due_date
            ? `Due ${new Date(c.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : timeAgo(c.created_at)}
          {c.source && <span className="ml-2 text-gray-300 dark:text-gray-600">&middot;</span>}
          {c.source && <span className="ml-2 capitalize">{c.source}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {showCompleteButton && (
          <button
            onClick={() => onComplete(c.id)}
            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-gray-400 hover:text-green-600 transition"
            aria-label="Mark complete"
            title="Mark complete"
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        {c.source_url && (
          <a
            href={c.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-400 hover:text-indigo-600 transition"
            aria-label="View source"
            title="View source"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </li>
  )
}

export default function DependenciesPage() {
  const [commitments, setCommitments] = useState<Commitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string>('')

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
          .in('status', ['open', 'in_progress', 'overdue'])
          .order('due_date', { ascending: true, nullsFirst: false })

        if (fetchError) throw fetchError
        setCommitments(data || [])
      } catch (err) {
        console.error('Error loading dependencies:', err)
        setError(err instanceof Error ? err.message : 'Failed to load data')
        toast.error('Failed to load dependencies')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleComplete = async (id: string) => {
    setCommitments(prev => prev.map(c => c.id === id ? { ...c, status: 'completed', completed_at: new Date().toISOString() } : c))

    const supabase = createClient()
    const { error } = await supabase
      .from('commitments')
      .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      setCommitments(prev => prev.map(c => c.id === id ? { ...c, status: 'open', completed_at: null } : c))
      toast.error('Failed to complete')
      return
    }
    toast.success('Marked complete')
  }

  if (loading) return <LoadingSkeleton variant="dashboard" />

  // Split into outbound (waiting on you) vs inbound (you're waiting on)
  const outbound = commitments.filter(c => {
    if (c.metadata?.direction === 'outbound') return true
    if (c.metadata?.direction === 'inbound') return false
    return c.creator_id === userId
  })
  const inbound = commitments.filter(c => {
    if (c.metadata?.direction === 'inbound') return true
    if (c.metadata?.direction === 'outbound') return false
    return c.assignee_id === userId && c.creator_id !== userId
  })

  // Check if we have real stakeholder data to group by
  const hasStakeholderData = commitments.some(c => c.metadata?.stakeholders && c.metadata.stakeholders.length > 0)

  const outboundGroups = hasStakeholderData ? groupByPerson(outbound, true) : []
  const inboundGroups = hasStakeholderData ? groupByPerson(inbound, false) : []

  const totalOverdue = commitments.filter(c => c.status === 'overdue' || (c.due_date && daysUntil(c.due_date) < 0)).length
  const onTrack = commitments.length > 0
    ? Math.round(((commitments.length - totalOverdue) / commitments.length) * 100)
    : 100

  // Detect cross-panel people (dependency chains) — only when grouped
  const outboundNames = new Set(outboundGroups.map(g => g.name))
  const inboundNames = new Set(inboundGroups.map(g => g.name))
  const chainedPeople = new Set([...outboundNames].filter(n => inboundNames.has(n) && n !== 'Unknown'))

  // Sort flat lists by urgency
  const sortByUrgency = (items: Commitment[]) => {
    return [...items].sort((a, b) => {
      const aUrgency = a.status === 'overdue' ? 0 : (a.due_date && daysUntil(a.due_date) <= 2) ? 1 : 2
      const bUrgency = b.status === 'overdue' ? 0 : (b.due_date && daysUntil(b.due_date) <= 2) ? 1 : 2
      return aUrgency - bUrgency
    })
  }

  return (
    <UpgradeGate featureKey="dependencies">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dependencies</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            See who&apos;s waiting on you and who you&apos;re waiting on
          </p>
        </div>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
            <span className="text-sm font-medium">{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
          </div>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Waiting on You</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{outbound.length} <span className="text-sm font-normal text-gray-400">items</span></p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">You&apos;re Waiting On</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{inbound.length} <span className="text-sm font-normal text-gray-400">items</span></p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Overdue</p>
            <p className={`text-2xl font-bold ${totalOverdue > 0 ? 'text-red-600' : 'text-green-600'}`}>{totalOverdue}</p>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Health</p>
            <p className={`text-2xl font-bold ${onTrack >= 80 ? 'text-green-600' : onTrack >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{onTrack}% <span className="text-sm font-normal text-gray-400">on track</span></p>
          </div>
        </div>

        {/* Two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Waiting on You */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ArrowDownLeft aria-hidden="true" className="w-5 h-5 text-red-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Waiting on You</h2>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                {outbound.length}
              </span>
            </div>

            {outbound.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-green-400 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No one is waiting on you. You&apos;re all clear!</p>
              </div>
            ) : hasStakeholderData ? (
              <div className="space-y-3">
                {outboundGroups.map(group => (
                  <div
                    key={group.name}
                    className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden border-l-4 ${urgencyBorderColor(group.urgency)}`}
                  >
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white">{group.name}</span>
                      {chainedPeople.has(group.name) && (
                        <span title="Mutual dependency"><Link2 aria-hidden="true" className="w-3.5 h-3.5 text-indigo-500" /></span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                        {group.commitments.length} item{group.commitments.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-50 dark:divide-gray-800">
                      {group.commitments.map(c => (
                        <CommitmentRow key={c.id} c={c} onComplete={handleComplete} showCompleteButton={true} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
                <ul className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortByUrgency(outbound).map(c => (
                    <CommitmentRow key={c.id} c={c} onComplete={handleComplete} showCompleteButton={true} />
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right: You're Waiting On */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ArrowUpRight aria-hidden="true" className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">You&apos;re Waiting On</h2>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                {inbound.length}
              </span>
            </div>

            {inbound.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl">
                <CheckCircle2 className="w-8 h-8 text-green-400 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">You&apos;re not waiting on anyone right now.</p>
              </div>
            ) : hasStakeholderData ? (
              <div className="space-y-3">
                {inboundGroups.map(group => (
                  <div
                    key={group.name}
                    className={`bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden border-l-4 ${urgencyBorderColor(group.urgency)}`}
                  >
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white">{group.name}</span>
                      {chainedPeople.has(group.name) && (
                        <span title="Mutual dependency"><Link2 aria-hidden="true" className="w-3.5 h-3.5 text-indigo-500" /></span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                        {group.commitments.length} item{group.commitments.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-50 dark:divide-gray-800">
                      {group.commitments.map(c => (
                        <CommitmentRow key={c.id} c={c} onComplete={handleComplete} showCompleteButton={false} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
                <ul className="divide-y divide-gray-50 dark:divide-gray-800">
                  {sortByUrgency(inbound).map(c => (
                    <CommitmentRow key={c.id} c={c} onComplete={handleComplete} showCompleteButton={false} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Chain callout — only when grouped by person */}
        {chainedPeople.size > 0 && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 flex items-start gap-3">
            <Link2 aria-hidden="true" className="w-5 h-5 text-indigo-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Mutual Dependencies Detected</p>
              <p className="text-xs text-indigo-700 dark:text-indigo-400 mt-1">
                You and <strong>{Array.from(chainedPeople).join(', ')}</strong> are waiting on each other.
                Consider syncing up to unblock both sides.
              </p>
            </div>
          </div>
        )}
      </div>
    </UpgradeGate>
  )
}
