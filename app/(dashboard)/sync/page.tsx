'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  RefreshCw, CheckCircle2, AlertCircle, Loader2, Mail, Zap,
  Clock, Activity, TrendingUp, Shield, ArrowRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

type SyncResult = {
  channels_processed?: number
  total_channels?: number
  messages_scanned?: number
  emails_scanned?: number
  commitments_detected: number
  duration_seconds: number
  pages_processed?: number
  errors?: string[]
}

type Integration = {
  provider: string
  created_at: string
}

export default function SyncPage() {
  const [syncingSlack, setSyncingSlack] = useState(false)
  const [syncingOutlook, setSyncingOutlook] = useState(false)
  const [slackResult, setSlackResult] = useState<SyncResult | null>(null)
  const [outlookResult, setOutlookResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [commitmentStats, setCommitmentStats] = useState({ total: 0, open: 0, completed: 0, thisWeek: 0 })
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadDataHealth()
  }, [])

  const loadDataHealth = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      if (!profile?.current_team_id) return
      const teamId = profile.current_team_id

      const [intResult, commitResult] = await Promise.all([
        supabase.from('integrations').select('provider, created_at').eq('team_id', teamId),
        supabase.from('commitments').select('status, created_at, source').eq('team_id', teamId),
      ])

      let integrationData = intResult.data || []

      const commitments = commitResult.data || []

      // Fallback: if integrations query returned empty (RLS) but we have commitments
      // from those sources, infer that integrations are connected
      if (integrationData.length === 0 && commitments.length > 0) {
        const sources = new Set(commitments.map((c: { source: string | null }) => c.source).filter(Boolean))
        if (sources.has('slack')) {
          integrationData.push({ provider: 'slack', created_at: new Date().toISOString() })
        }
        if (sources.has('outlook') || sources.has('email')) {
          integrationData.push({ provider: 'outlook', created_at: new Date().toISOString() })
        }
      }

      setIntegrations(integrationData as Integration[])

      const weekAgo = Date.now() - 7 * 86400000
      setCommitmentStats({
        total: commitments.length,
        open: commitments.filter((c: { status: string }) => c.status === 'open' || c.status === 'overdue').length,
        completed: commitments.filter((c: { status: string }) => c.status === 'completed').length,
        thisWeek: commitments.filter((c: { created_at: string }) => new Date(c.created_at).getTime() > weekAgo).length,
      })
    } catch (err) {
      console.error('Error loading data health:', err)
    } finally {
      setLoading(false)
    }
  }

  const hasSlack = integrations.some(i => i.provider === 'slack')
  const hasOutlook = integrations.some(i => i.provider === 'outlook')
  const slackIntegration = integrations.find(i => i.provider === 'slack')
  const outlookIntegration = integrations.find(i => i.provider === 'outlook')

  const handleSlackSync = async () => {
    setSyncingSlack(true)
    setSlackResult(null)
    setError(null)

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) {
        setError('Not authenticated. Please log in again.')
        setSyncingSlack(false)
        return
      }

      toast('Syncing Slack history... This may take a few minutes.', { icon: '\u{1F504}' })

      const response = await fetch('/api/integrations/slack/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.user.id, daysBack: 30 }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Slack sync failed')
        toast.error(data.error || 'Slack sync failed')
      } else {
        setSlackResult(data.summary)
        toast.success(`Slack sync complete! Found ${data.summary.commitments_detected} commitments.`)
        loadDataHealth()
      }
    } catch {
      setError('Network error. Please try again.')
      toast.error('Network error')
    } finally {
      setSyncingSlack(false)
    }
  }

  const handleOutlookSync = async () => {
    setSyncingOutlook(true)
    setOutlookResult(null)
    setError(null)

    try {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) {
        setError('Not authenticated. Please log in again.')
        setSyncingOutlook(false)
        return
      }

      toast('Syncing Outlook emails... This may take a few minutes.', { icon: '\u{1F4E7}' })

      const response = await fetch('/api/integrations/outlook/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.user.id, daysBack: 30 }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Outlook sync failed')
        toast.error(data.error || 'Outlook sync failed')
      } else {
        setOutlookResult(data.summary)
        toast.success(`Outlook sync complete! Found ${data.summary.commitments_detected} commitments.`)
        loadDataHealth()
      }
    } catch {
      setError('Network error. Please try again.')
      toast.error('Network error')
    } finally {
      setSyncingOutlook(false)
    }
  }

  const getHealthScore = () => {
    let score = 0
    if (hasSlack) score += 35
    if (hasOutlook) score += 35
    if (commitmentStats.total > 0) score += 15
    if (commitmentStats.thisWeek > 0) score += 15
    return score
  }

  const healthScore = getHealthScore()
  const healthColor = healthScore >= 70 ? 'text-green-600' : healthScore >= 40 ? 'text-amber-600' : 'text-red-600'
  const healthBg = healthScore >= 70 ? 'from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10' : healthScore >= 40 ? 'from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10' : 'from-red-50 to-orange-50 dark:from-red-900/10 dark:to-orange-900/10'
  const healthLabel = healthScore >= 70 ? 'Healthy' : healthScore >= 40 ? 'Needs Attention' : 'Action Required'

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" role="status" aria-busy="true" aria-label="Loading data health">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white" style={{ letterSpacing: '-0.025em' }}>
          Data Health
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
          Monitor your data sources, sync status, and commitment coverage
        </p>
      </div>

      {/* Health Score Hero */}
      <div className={`bg-gradient-to-br ${healthBg} border border-gray-200 dark:border-gray-700 rounded-xl p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-200 dark:text-gray-700" />
                <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" strokeWidth="6"
                  className={healthColor}
                  strokeDasharray={`${healthScore * 1.885} 188.5`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-xl font-bold ${healthColor}`}>{healthScore}</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className={`text-2xl font-bold ${healthColor}`}>{healthLabel}</h2>
                {healthScore >= 70 && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                {healthScore < 40 && <AlertCircle className="w-5 h-5 text-red-500" />}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                {healthScore >= 70
                  ? 'All sources connected and actively syncing. Great coverage!'
                  : healthScore >= 40
                    ? 'Connect another source for complete commitment coverage.'
                    : 'Connect Slack or Outlook to start tracking commitments.'}
              </p>
            </div>
          </div>
          {healthScore < 70 && (
            <Link
              href="/integrations"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-white dark:bg-white/10 rounded-lg border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition"
            >
              <Zap className="w-4 h-4" />
              Connect Sources
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Tracked</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{commitmentStats.total}</p>
          <p className="text-xs text-gray-400 mt-1">commitments detected</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Open Items</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{commitmentStats.open}</p>
          <p className="text-xs text-gray-400 mt-1">awaiting resolution</p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Completed</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{commitmentStats.completed}</p>
          <p className="text-xs text-gray-400 mt-1">
            {commitmentStats.total > 0 ? `${Math.round(commitmentStats.completed / commitmentStats.total * 100)}% follow-through` : 'none yet'}
          </p>
        </div>
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-violet-500" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">This Week</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{commitmentStats.thisWeek}</p>
          <p className="text-xs text-gray-400 mt-1">new commitments found</p>
        </div>
      </div>

      {/* Connected Sources */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Connected Sources</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Slack Card */}
          <div className={`bg-white dark:bg-surface-dark-secondary border rounded-xl p-5 ${
            hasSlack ? 'border-green-200 dark:border-green-800/50' : 'border-gray-200 dark:border-border-dark'
          }`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#4A154B' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="white"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Slack</h3>
                  {hasSlack ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">Connected</span>
                      <span className="text-xs text-gray-400 ml-1">
                        since {new Date(slackIntegration!.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Not connected</p>
                  )}
                </div>
              </div>
            </div>

            {hasSlack ? (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Scans public channels, private channels, and DMs from the last 30 days to find commitments and promises.
                </p>
                <button
                  onClick={handleSlackSync}
                  disabled={syncingSlack}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg transition font-medium text-sm disabled:opacity-60"
                  style={{
                    background: syncingSlack ? '#9CA3AF' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    boxShadow: syncingSlack ? 'none' : '0 2px 8px rgba(79, 70, 229, 0.25)',
                  }}
                >
                  {syncingSlack ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Syncing Slack...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4" /> Sync Last 30 Days</>
                  )}
                </button>
              </div>
            ) : (
              <Link
                href="/integrations"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition"
              >
                <Zap className="w-4 h-4" /> Connect Slack
              </Link>
            )}

            {slackResult && (
              <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="font-semibold text-green-900 dark:text-green-300 text-sm">Sync Complete</span>
                  <span className="text-xs text-green-600 dark:text-green-400 ml-auto">{slackResult.duration_seconds}s</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{slackResult.channels_processed}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Channels</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{slackResult.messages_scanned?.toLocaleString()}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Messages</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{slackResult.commitments_detected}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Found</p>
                  </div>
                </div>
                {slackResult.commitments_detected > 0 && (
                  <Link href="/commitments" className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline">
                    View new commitments <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
                {slackResult.errors && slackResult.errors.length > 0 && (
                  <div className="mt-3 text-xs text-yellow-700 dark:text-yellow-400">
                    <p className="font-medium">Some channels had issues:</p>
                    {slackResult.errors.map((e, i) => <p key={i} className="truncate">{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Outlook Card */}
          <div className={`bg-white dark:bg-surface-dark-secondary border rounded-xl p-5 ${
            hasOutlook ? 'border-green-200 dark:border-green-800/50' : 'border-gray-200 dark:border-border-dark'
          }`}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#0078D4' }}>
                  <Mail className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">Outlook</h3>
                  {hasOutlook ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-2 h-2 bg-green-500 rounded-full" />
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">Connected</span>
                      <span className="text-xs text-gray-400 ml-1">
                        since {new Date(outlookIntegration!.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">Not connected</p>
                  )}
                </div>
              </div>
            </div>

            {hasOutlook ? (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Scans your inbox and sent emails from the last 30 days to find commitments, promises, and action items.
                </p>
                <button
                  onClick={handleOutlookSync}
                  disabled={syncingOutlook}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg transition font-medium text-sm disabled:opacity-60"
                  style={{
                    background: syncingOutlook ? '#9CA3AF' : 'linear-gradient(135deg, #0078D4 0%, #005A9E 100%)',
                    boxShadow: syncingOutlook ? 'none' : '0 2px 8px rgba(0, 120, 212, 0.25)',
                  }}
                >
                  {syncingOutlook ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Syncing Outlook...</>
                  ) : (
                    <><Mail className="w-4 h-4" /> Sync Last 30 Days</>
                  )}
                </button>
              </div>
            ) : (
              <Link
                href="/integrations"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
              >
                <Zap className="w-4 h-4" /> Connect Outlook
              </Link>
            )}

            {outlookResult && (
              <div className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="font-semibold text-green-900 dark:text-green-300 text-sm">Sync Complete</span>
                  <span className="text-xs text-green-600 dark:text-green-400 ml-auto">{outlookResult.duration_seconds}s</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{outlookResult.pages_processed}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Pages</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{outlookResult.emails_scanned?.toLocaleString()}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Emails</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-green-900 dark:text-green-200">{outlookResult.commitments_detected}</p>
                    <p className="text-[10px] text-green-700 dark:text-green-400 font-medium">Found</p>
                  </div>
                </div>
                {outlookResult.commitments_detected > 0 && (
                  <Link href="/commitments" className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-300 hover:underline">
                    View new commitments <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
                {outlookResult.errors && outlookResult.errors.length > 0 && (
                  <div className="mt-3 text-xs text-yellow-700 dark:text-yellow-400">
                    <p className="font-medium">Some issues occurred:</p>
                    {outlookResult.errors.map((e, i) => <p key={i} className="truncate">{e}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 text-xs font-medium">Dismiss</button>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/50 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-indigo-900 dark:text-indigo-200 text-sm mb-1">Privacy-first sync</h3>
            <p className="text-xs text-indigo-700 dark:text-indigo-400 leading-relaxed">
              HeyWren reads messages from your connected Slack channels and Outlook inbox with <strong>read-only access</strong>.
              Each message is analyzed by AI to detect commitments, promises, and tasks.
              HeyWren never posts, sends, or modifies anything in Slack or Outlook.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
