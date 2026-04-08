'use client'

import { useEffect, useState } from 'react'
import {
  ListFilter, FolderInput, Trash2, ToggleLeft, ToggleRight,
  AlertCircle, CheckCircle2, Clock, XCircle, Loader2,
  Mail, AtSign, FileText, ArrowRight, RefreshCw, Inbox,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import UpgradeGate from '@/components/upgrade-gate'

interface EmailRule {
  id: string
  match_type: 'from_email' | 'from_domain' | 'subject_contains'
  match_value: string
  target_folder_id: string
  target_folder_name: string
  mark_as_read: boolean
  outlook_rule_id: string | null
  sync_status: 'pending' | 'synced' | 'failed' | 'disabled'
  sync_error: string | null
  emails_moved: number
  last_applied_at: string | null
  created_at: string
}

interface Stats {
  totalRules: number
  totalMoved: number
}

const matchTypeConfig = {
  from_email: { label: 'Sender', icon: Mail, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  from_domain: { label: 'Domain', icon: AtSign, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  subject_contains: { label: 'Subject', icon: FileText, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
}

const syncStatusConfig = {
  synced: { label: 'Active', icon: CheckCircle2, color: 'text-green-600 dark:text-green-400' },
  pending: { label: 'Pending', icon: Clock, color: 'text-amber-600 dark:text-amber-400' },
  failed: { label: 'Failed', icon: XCircle, color: 'text-red-600 dark:text-red-400' },
  disabled: { label: 'Disabled', icon: ToggleLeft, color: 'text-gray-400' },
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function EmailRulesPage() {
  const [rules, setRules] = useState<EmailRule[]>([])
  const [stats, setStats] = useState<Stats>({ totalRules: 0, totalMoved: 0 })
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const fetchRules = async () => {
    try {
      const res = await fetch('/api/email-rules')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setRules(data.rules || [])
      setStats(data.stats || { totalRules: 0, totalMoved: 0 })
    } catch {
      toast.error('Failed to load email rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRules()
  }, [])

  const toggleRule = async (rule: EmailRule) => {
    const action = rule.sync_status === 'disabled' ? 'enable' : 'disable'
    setActionLoading(prev => ({ ...prev, [rule.id]: true }))
    try {
      const res = await fetch('/api/email-rules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId: rule.id, action }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(action === 'enable' ? 'Rule enabled' : 'Rule disabled')
      fetchRules()
    } catch {
      toast.error('Failed to update rule')
    } finally {
      setActionLoading(prev => ({ ...prev, [rule.id]: false }))
    }
  }

  const deleteRule = async (rule: EmailRule) => {
    setActionLoading(prev => ({ ...prev, [rule.id]: true }))
    try {
      const res = await fetch('/api/email-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId: rule.id }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Rule deleted')
      fetchRules()
    } catch {
      toast.error('Failed to delete rule')
    } finally {
      setActionLoading(prev => ({ ...prev, [rule.id]: false }))
    }
  }

  if (loading) {
    return <LoadingSkeleton variant="list" />
  }

  const activeRules = rules.filter(r => r.sync_status !== 'disabled')
  const disabledRules = rules.filter(r => r.sync_status === 'disabled')

  return (
    <UpgradeGate feature="emailRules">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                <ListFilter className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              Email Rules
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Automatically route emails to folders. Each rule also creates an Outlook inbox rule.
            </p>
          </div>
          <button
            onClick={() => fetchRules()}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalRules}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Active Rules</div>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalMoved.toLocaleString()}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Emails Organized</div>
          </div>
          <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5">
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {rules.length > 0 ? `${rules.length}` : '0'}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Rules</div>
          </div>
        </div>

        {/* Info box */}
        {rules.length === 0 && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <FolderInput className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Organize your inbox</h3>
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
                  Rules are created when you use the &quot;Organize&quot; button on emails in the
                  <a href="/missed-emails" className="underline font-medium ml-1">Missed Emails</a> or
                  <a href="/unsubscribe" className="underline font-medium ml-1">Unsubscribe</a> pages.
                  Each rule routes matching emails to a folder and creates a rule in Outlook so future emails are auto-sorted.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Active rules */}
        {activeRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Active Rules ({activeRules.length})
            </h2>
            {activeRules.map(rule => {
              const typeConfig = matchTypeConfig[rule.match_type]
              const statusConfig = syncStatusConfig[rule.sync_status]
              const TypeIcon = typeConfig.icon
              const StatusIcon = statusConfig.icon
              const isLoading = actionLoading[rule.id]

              return (
                <div
                  key={rule.id}
                  className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 flex items-center gap-4"
                >
                  {/* Match info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${typeConfig.color}`}>
                        <TypeIcon className="w-3 h-3" />
                        {typeConfig.label}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {rule.match_value}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                        <Inbox className="w-3 h-3" />
                        {rule.target_folder_name}
                      </span>
                      {rule.mark_as_read && (
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">+ mark read</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span className="flex items-center gap-1">
                        <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
                        <span className={statusConfig.color}>{statusConfig.label}</span>
                      </span>
                      {rule.sync_error && (
                        <span className="flex items-center gap-1 text-red-500">
                          <AlertCircle className="w-3 h-3" />
                          {rule.sync_error}
                        </span>
                      )}
                      <span>{rule.emails_moved.toLocaleString()} emails moved</span>
                      <span>Created {formatDate(rule.created_at)}</span>
                      {rule.last_applied_at && (
                        <span>Last applied {formatDate(rule.last_applied_at)}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleRule(rule)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40"
                      title={rule.sync_status === 'disabled' ? 'Enable rule' : 'Disable rule'}
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ToggleRight className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRule(rule)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40"
                      title="Delete rule"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Disabled rules */}
        {disabledRules.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Disabled Rules ({disabledRules.length})
            </h2>
            {disabledRules.map(rule => {
              const typeConfig = matchTypeConfig[rule.match_type]
              const TypeIcon = typeConfig.icon
              const isLoading = actionLoading[rule.id]

              return (
                <div
                  key={rule.id}
                  className="bg-white/50 dark:bg-surface-dark-secondary/50 rounded-xl border border-gray-200 dark:border-border-dark p-5 flex items-center gap-4 opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${typeConfig.color}`}>
                        <TypeIcon className="w-3 h-3" />
                        {typeConfig.label}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {rule.match_value}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-500">{rule.target_folder_name}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>{rule.emails_moved.toLocaleString()} emails moved</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleRule(rule)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-green-600 dark:hover:text-green-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40"
                      title="Enable rule"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ToggleLeft className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteRule(rule)}
                      disabled={isLoading}
                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-40"
                      title="Delete rule"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Empty state */}
        {rules.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
              <FolderInput className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No email rules yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md">
              Use the &quot;Organize&quot; button on emails in Missed Emails or Unsubscribe to create your first rule.
              Each rule sorts matching emails into a folder automatically.
            </p>
          </div>
        )}
      </div>
    </UpgradeGate>
  )
}
