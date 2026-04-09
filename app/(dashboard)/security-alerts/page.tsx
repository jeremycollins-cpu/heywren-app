'use client'

import { useEffect, useState } from 'react'
import {
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Flag,
  Loader2, ChevronDown, ChevronUp, Eye, EyeOff, RefreshCw,
  Mail, Link2, UserX, CreditCard, Key, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface ThreatSignal {
  signal: string
  detail: string
  weight: 'critical' | 'high' | 'medium' | 'low'
}

interface ThreatAlert {
  id: string
  from_name: string | null
  from_email: string
  subject: string | null
  received_at: string
  threat_level: 'critical' | 'high' | 'medium' | 'low'
  threat_type: string
  confidence: number
  signals: ThreatSignal[]
  explanation: string
  recommended_actions: string[]
  do_not_actions: string[]
  spf_result: string | null
  dkim_result: string | null
  dmarc_result: string | null
  reply_to_mismatch: boolean
  sender_mismatch: boolean
  status: string
  user_feedback: string | null
  created_at: string
}

const threatTypeConfig: Record<string, { label: string; icon: any; color: string }> = {
  phishing: { label: 'Phishing', icon: Key, color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  spoofing: { label: 'Spoofing', icon: UserX, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  bec: { label: 'Business Email Compromise', icon: Users, color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  malware_link: { label: 'Malicious Link', icon: Link2, color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400' },
  payment_fraud: { label: 'Payment Fraud', icon: CreditCard, color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  impersonation: { label: 'Impersonation', icon: UserX, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
}

const threatLevelStyles = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-l-4 border-l-red-500', badge: 'bg-red-600 text-white' },
  high: { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-l-4 border-l-orange-500', badge: 'bg-orange-600 text-white' },
  medium: { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-l-4 border-l-amber-500', badge: 'bg-amber-600 text-white' },
  low: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-l-4 border-l-blue-400', badge: 'bg-blue-600 text-white' },
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function SecurityAlertsPage() {
  const [alerts, setAlerts] = useState<ThreatAlert[]>([])
  const [resolved, setResolved] = useState<ThreatAlert[]>([])
  const [stats, setStats] = useState({ unreviewed: 0, critical: 0, confirmed: 0, falsePositives: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [showResolved, setShowResolved] = useState(false)

  const fetchAlerts = async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/email-threats')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setAlerts(data.alerts || [])
      setResolved(data.resolved || [])
      setStats(data.stats || { unreviewed: 0, critical: 0, confirmed: 0, falsePositives: 0 })
    } catch {
      toast.error('Failed to load security alerts')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { fetchAlerts() }, [])

  const handleAction = async (alertId: string, action: string) => {
    setActionLoading(prev => ({ ...prev, [alertId]: true }))
    try {
      const res = await fetch('/api/email-threats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId, action }),
      })
      if (!res.ok) throw new Error('Failed')
      const labels: Record<string, string> = {
        confirmed_threat: 'Confirmed as threat',
        safe: 'Marked as safe',
        reported: 'Reported to IT',
        dismissed: 'Dismissed',
      }
      toast.success(labels[action] || 'Updated')
      fetchAlerts()
    } catch {
      toast.error('Failed to update alert')
    } finally {
      setActionLoading(prev => ({ ...prev, [alertId]: false }))
    }
  }

  if (loading) return <LoadingSkeleton variant="list" />

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            Security Alerts
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Wren scans your emails for phishing, scams, and impersonation attempts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setScanning(true)
              try {
                const res = await fetch('/api/email-threats', { method: 'POST' })
                if (res.ok) {
                  toast.success('Security scan started — results will appear in a minute or two.')
                  setTimeout(() => fetchAlerts(), 30000)
                  setTimeout(() => fetchAlerts(), 90000)
                } else {
                  toast.error('Failed to start scan')
                }
              } catch { toast.error('Failed to start scan') }
              finally { setScanning(false) }
            }}
            disabled={scanning}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
            {scanning ? 'Starting...' : 'Scan Now'}
          </button>
          <button
            onClick={fetchAlerts}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.unreviewed}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Unreviewed</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.critical}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Critical</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.confirmed}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Confirmed Threats</div>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 text-center">
          <div className="text-2xl font-bold text-gray-400">{stats.falsePositives}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">False Positives</div>
        </div>
      </div>

      {/* How it works */}
      {alerts.length === 0 && resolved.length === 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-green-900 dark:text-green-200">Your inbox looks safe</h3>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                Wren scans your recent emails daily for phishing, scam, and impersonation attempts.
                Only high-confidence threats are shown here — we&apos;d rather miss a borderline case than cry wolf.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active alerts */}
      {alerts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Requires Your Attention ({alerts.length})
          </h2>

          {alerts.map(alert => {
            const levelStyle = threatLevelStyles[alert.threat_level]
            const typeConfig = threatTypeConfig[alert.threat_type] || threatTypeConfig.phishing
            const TypeIcon = typeConfig.icon
            const isExpanded = expandedId === alert.id
            const isLoading = actionLoading[alert.id]

            return (
              <div key={alert.id} className={`${levelStyle.bg} ${levelStyle.border} rounded-xl overflow-hidden`}>
                {/* Header row */}
                <div
                  className="p-5 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold rounded-full ${levelStyle.badge}`}>
                          {alert.threat_level.toUpperCase()}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${typeConfig.color}`}>
                          <TypeIcon className="w-3 h-3" />
                          {typeConfig.label}
                        </span>
                        <span className="text-xs text-gray-400">
                          {Math.round(alert.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mt-2">
                        {alert.subject || '(no subject)'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        From: {alert.from_name || alert.from_email} &middot; {formatDate(alert.received_at)}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                  </div>

                  {/* Explanation (always visible) */}
                  <div className="mt-3 p-3 bg-white/60 dark:bg-white/5 rounded-lg">
                    <p className="text-sm text-gray-800 dark:text-gray-200">
                      <span className="font-semibold">Why this is suspicious:</span> {alert.explanation}
                    </p>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 space-y-4 border-t border-white/30 dark:border-white/10">
                    {/* Signals */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 mt-4">Threat Signals</h4>
                      <div className="space-y-1.5">
                        {(alert.signals || []).map((signal: ThreatSignal, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                              signal.weight === 'critical' ? 'bg-red-500' :
                              signal.weight === 'high' ? 'bg-orange-500' :
                              signal.weight === 'medium' ? 'bg-amber-500' : 'bg-blue-400'
                            }`} />
                            <span className="text-gray-700 dark:text-gray-300">{signal.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Auth results */}
                    {(alert.spf_result || alert.dkim_result || alert.dmarc_result) && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Email Authentication</h4>
                        <div className="flex gap-3 text-xs">
                          {['SPF', 'DKIM', 'DMARC'].map(name => {
                            const result = name === 'SPF' ? alert.spf_result : name === 'DKIM' ? alert.dkim_result : alert.dmarc_result
                            if (!result || result === 'none') return null
                            const passed = result === 'pass'
                            return (
                              <span key={name} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium ${
                                passed
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                              }`}>
                                {passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                {name}: {result}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* What to do / What NOT to do */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> What to do
                        </h4>
                        <ul className="space-y-1">
                          {(alert.recommended_actions || []).map((action, i) => (
                            <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                              <span className="text-green-500 mt-0.5">+</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> What NOT to do
                        </h4>
                        <ul className="space-y-1">
                          {(alert.do_not_actions || []).map((action, i) => (
                            <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
                              <span className="text-red-500 mt-0.5">-</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={() => handleAction(alert.id, 'confirmed_threat')}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-40"
                      >
                        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
                        Confirm Threat
                      </button>
                      <button
                        onClick={() => handleAction(alert.id, 'reported')}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition disabled:opacity-40"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Report to IT
                      </button>
                      <button
                        onClick={() => handleAction(alert.id, 'safe')}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        This is Safe
                      </button>
                      <button
                        onClick={() => handleAction(alert.id, 'dismissed')}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition disabled:opacity-40"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Resolved (collapsible) */}
      {resolved.length > 0 && (
        <div>
          <button
            onClick={() => setShowResolved(!showResolved)}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showResolved ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showResolved ? 'Hide' : 'Show'} resolved alerts ({resolved.length})
          </button>

          {showResolved && (
            <div className="mt-3 space-y-2">
              {resolved.map(alert => {
                const typeConfig = threatTypeConfig[alert.threat_type] || threatTypeConfig.phishing
                const statusLabels: Record<string, string> = {
                  confirmed_threat: 'Confirmed',
                  safe: 'Marked Safe',
                  reported: 'Reported',
                  dismissed: 'Dismissed',
                }
                return (
                  <div key={alert.id} className="bg-white/50 dark:bg-surface-dark-secondary/50 rounded-lg border border-gray-200 dark:border-border-dark p-4 opacity-60">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${typeConfig.color}`}>
                          {typeConfig.label}
                        </span>
                        <span className="text-sm text-gray-700 dark:text-gray-300 ml-2">{alert.subject}</span>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        alert.status === 'confirmed_threat' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' :
                        alert.status === 'safe' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                        'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                      }`}>
                        {statusLabels[alert.status] || alert.status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
