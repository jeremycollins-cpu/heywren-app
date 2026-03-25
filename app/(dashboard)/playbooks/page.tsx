'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, Plus, CheckCircle2, Trash2, X, Zap, ToggleLeft, ToggleRight } from 'lucide-react'
import UpgradeGate from '@/components/upgrade-gate'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Playbook {
  id: string
  team_id: string
  created_by: string
  name: string
  description: string | null
  trigger_type: string
  trigger_config: Record<string, unknown> | null
  action_type: string
  action_config: Record<string, unknown> | null
  enabled: boolean
  run_count: number
  last_run_at: string | null
  created_at: string
  updated_at: string
}

const TRIGGER_LABELS: Record<string, string> = {
  commitment_created: 'When a commitment is created',
  commitment_overdue: 'When a commitment becomes overdue',
  commitment_stale: 'When a commitment goes stale (7+ days)',
  meeting_upcoming: 'Before a meeting starts',
  nudge_ignored: 'When a nudge is ignored',
  daily_schedule: 'Every day at a set time',
}

const ACTION_LABELS: Record<string, string> = {
  send_nudge: 'Send a nudge reminder',
  send_slack: 'Send a Slack message',
  send_email: 'Send an email',
  create_draft: 'Create a draft follow-up',
  escalate: 'Escalate to manager',
  reassign: 'Reassign the commitment',
}

const TRIGGER_TYPES = Object.keys(TRIGGER_LABELS)
const ACTION_TYPES = Object.keys(ACTION_LABELS)

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formTrigger, setFormTrigger] = useState(TRIGGER_TYPES[0])
  const [formAction, setFormAction] = useState(ACTION_TYPES[0])
  const [submitting, setSubmitting] = useState(false)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient()

        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) {
          setLoading(false)
          return
        }

        setUserId(userData.user.id)

        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', userData.user.id)
          .single()

        const tid = profile?.current_team_id
        if (!tid) {
          setLoading(false)
          return
        }

        setTeamId(tid)

        const { data, error: fetchError } = await supabase
          .from('playbooks')
          .select('*')
          .eq('team_id', tid)
          .order('created_at', { ascending: false })

        if (fetchError) {
          console.error('Error fetching playbooks:', fetchError)
          setError('Failed to load playbooks. Please try again.')
          toast.error('Failed to load playbooks')
        }

        if (data) setPlaybooks(data)
      } catch (err) {
        console.error('Error loading playbooks:', err)
        const message = err instanceof Error ? err.message : 'Failed to load playbooks'
        setError(message)
        toast.error('Failed to load playbooks')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()

    if (!teamId || !userId) {
      toast.error('Not authenticated')
      return
    }

    if (!formName.trim()) {
      toast.error('Please enter a playbook name')
      return
    }

    try {
      setSubmitting(true)
      const supabase = createClient()

      const { data, error } = await supabase
        .from('playbooks')
        .insert({
          team_id: teamId,
          created_by: userId,
          name: formName.trim(),
          description: formDescription.trim() || null,
          trigger_type: formTrigger,
          trigger_config: {},
          action_type: formAction,
          action_config: {},
          enabled: true,
        })
        .select()
        .single()

      if (error) throw error

      setPlaybooks([data, ...playbooks])
      setShowModal(false)
      setFormName('')
      setFormDescription('')
      setFormTrigger(TRIGGER_TYPES[0])
      setFormAction(ACTION_TYPES[0])
      toast.success('Playbook created')
    } catch (err) {
      console.error('Error creating playbook:', err)
      toast.error('Failed to create playbook')
    } finally {
      setSubmitting(false)
    }
  }

  async function togglePlaybook(id: string, currentEnabled: boolean) {
    const supabase = createClient()
    const newEnabled = !currentEnabled

    // Optimistic update
    setPlaybooks(prev => prev.map(p => p.id === id ? { ...p, enabled: newEnabled } : p))

    const { error } = await supabase
      .from('playbooks')
      .update({ enabled: newEnabled, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      // Revert on failure
      setPlaybooks(prev => prev.map(p => p.id === id ? { ...p, enabled: currentEnabled } : p))
      console.error('Error toggling playbook:', error)
      toast.error('Failed to update playbook')
    } else {
      toast.success(newEnabled ? 'Playbook enabled' : 'Playbook disabled')
    }
  }

  async function deletePlaybook(id: string) {
    const supabase = createClient()

    const { error } = await supabase
      .from('playbooks')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting playbook:', error)
      toast.error('Failed to delete playbook')
    } else {
      setPlaybooks(prev => prev.filter(p => p.id !== id))
      toast.success('Playbook deleted')
    }
    setDeletingId(null)
  }

  // Stats
  const totalPlaybooks = playbooks.length
  const activeCount = playbooks.filter(p => p.enabled).length
  const totalActions = playbooks.reduce((sum, p) => sum + (p.run_count || 0), 0)

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  return (
    <UpgradeGate featureKey="playbooks">
    <div className="space-y-6">
      {error && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-sm font-medium">Dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Playbooks</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Rules that automate how HeyWren handles your commitments — define once, enforce forever
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
        >
          <Plus aria-hidden="true" className="w-5 h-5" />
          New Playbook
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Playbooks</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{totalPlaybooks}</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Active</p>
          <p className="text-3xl font-bold text-green-600">{activeCount}</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Actions Automated</p>
          <p className="text-3xl font-bold text-indigo-600">{totalActions}</p>
        </div>
      </div>

      {/* Starter Templates */}
      {playbooks.length === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Start with a Template</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { name: 'Overdue Nudge', desc: 'Remind yourself when commitments go overdue', trigger: 'commitment_overdue', action: 'send_nudge', icon: '⏰' },
              { name: 'Stale Item Alert', desc: 'Get notified about stale 7+ day items', trigger: 'commitment_stale', action: 'send_slack', icon: '🔔' },
              { name: 'Auto Draft Follow-up', desc: 'Create a draft email when new commitments arrive', trigger: 'commitment_created', action: 'create_draft', icon: '✉️' },
              { name: 'Meeting Prep Reminder', desc: 'Get a briefing before meetings start', trigger: 'meeting_upcoming', action: 'send_nudge', icon: '📋' },
              { name: 'Escalation Rule', desc: 'Escalate ignored nudges to your manager', trigger: 'nudge_ignored', action: 'escalate', icon: '🚨' },
              { name: 'Daily Digest', desc: 'Get a daily summary of your commitments', trigger: 'daily_schedule', action: 'send_email', icon: '📊' },
            ].map(template => (
              <button
                key={template.name}
                onClick={() => {
                  setFormName(template.name)
                  setFormDescription(template.desc)
                  setFormTrigger(template.trigger)
                  setFormAction(template.action)
                  setShowModal(true)
                }}
                className="text-left p-4 bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg" aria-hidden="true">{template.icon}</span>
                  <span className="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">{template.name}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{template.desc}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded font-medium">{TRIGGER_LABELS[template.trigger]?.replace('When a ', '').replace('When a commitment ', '')}</span>
                  <span className="text-gray-300 dark:text-gray-600 text-[10px]">&rarr;</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded font-medium">{ACTION_LABELS[template.action]?.replace('Send a ', '').replace('Create a ', '')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Playbooks List */}
      <div className="space-y-3">
        {playbooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No custom playbooks yet</h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mb-6">
              Pick a template above to get started, or create a custom automation rule from scratch.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
            >
              <Plus aria-hidden="true" className="w-5 h-5" />
              Create Custom Playbook
            </button>
          </div>
        ) : (
          playbooks.map((playbook) => (
            <div
              key={playbook.id}
              className={`border rounded-lg p-6 transition-all ${
                playbook.enabled
                  ? 'bg-white dark:bg-surface-dark-secondary border-gray-200 dark:border-border-dark hover:shadow-md'
                  : 'bg-gray-50 dark:bg-surface-dark border-gray-200 dark:border-border-dark'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`w-2 h-2 rounded-full ${playbook.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <h3 className="font-semibold text-gray-900 dark:text-white">{playbook.name}</h3>
                    {playbook.run_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Zap aria-hidden="true" className="w-3 h-3" />
                        {playbook.run_count} run{playbook.run_count !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {playbook.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{playbook.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => togglePlaybook(playbook.id, playbook.enabled)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                    aria-label={playbook.enabled ? 'Disable playbook' : 'Enable playbook'}
                  >
                    {playbook.enabled ? (
                      <ToggleRight aria-hidden="true" className="w-6 h-6 text-green-600" />
                    ) : (
                      <ToggleLeft aria-hidden="true" className="w-6 h-6 text-gray-400" />
                    )}
                  </button>
                  {deletingId === playbook.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deletePlaybook(playbook.id)}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(playbook.id)}
                      className="p-2 hover:bg-red-50 rounded-lg transition text-red-600"
                      aria-label="Delete playbook"
                    >
                      <Trash2 aria-hidden="true" className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold mb-2">Trigger</p>
                  <div className="bg-gray-50 dark:bg-surface-dark rounded p-3 text-sm text-gray-700 dark:text-gray-300">
                    {TRIGGER_LABELS[playbook.trigger_type] || playbook.trigger_type}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold mb-2">Action</p>
                  <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded p-3 text-sm text-indigo-700 dark:text-indigo-300">
                    {ACTION_LABELS[playbook.action_type] || playbook.action_type}
                  </div>
                </div>
              </div>

              {playbook.last_run_at && (
                <p className="text-xs text-gray-400 mt-3">
                  Last run: {new Date(playbook.last_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 mb-2">How Playbooks Work</h3>
        <p className="text-sm text-indigo-800 dark:text-indigo-300 mb-3">
          Create custom automation rules to handle repetitive workflows and ensure consistent follow-through.
        </p>
        <ul className="text-sm text-indigo-800 dark:text-indigo-300 space-y-1">
          <li>&#10003; Define triggers based on calendar, email, or tool events</li>
          <li>&#10003; Set actions like notifications, scheduling, or automated messages</li>
          <li>&#10003; Track execution metrics for each playbook</li>
          <li>&#10003; No-code rule builder — anyone can create playbooks</li>
        </ul>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="new-playbook-title">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !submitting && setShowModal(false)}
            aria-hidden="true"
          />
          <div className="relative bg-white dark:bg-surface-dark-secondary rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 id="new-playbook-title" className="text-xl font-bold text-gray-900 dark:text-white">New Playbook</h2>
              <button
                onClick={() => !submitting && setShowModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
                aria-label="Close dialog"
              >
                <X aria-hidden="true" className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label htmlFor="playbook-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
                <input
                  id="playbook-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Nudge overdue commitments"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition dark:bg-surface-dark dark:text-white"
                  disabled={submitting}
                  aria-required="true"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="playbook-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                <textarea
                  id="playbook-description"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What does this playbook do?"
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition dark:bg-surface-dark dark:text-white dark:placeholder-gray-500 resize-none"
                  disabled={submitting}
                />
              </div>

              <div>
                <label htmlFor="playbook-trigger" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Trigger</label>
                <select
                  id="playbook-trigger"
                  value={formTrigger}
                  onChange={(e) => setFormTrigger(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition dark:bg-surface-dark dark:text-white"
                  disabled={submitting}
                >
                  {TRIGGER_TYPES.map(t => (
                    <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="playbook-action" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Action</label>
                <select
                  id="playbook-action"
                  value={formAction}
                  onChange={(e) => setFormAction(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition dark:bg-surface-dark dark:text-white"
                  disabled={submitting}
                >
                  {ACTION_TYPES.map(a => (
                    <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-medium"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formName.trim()}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Creating...' : 'Create Playbook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </UpgradeGate>
  )
}
