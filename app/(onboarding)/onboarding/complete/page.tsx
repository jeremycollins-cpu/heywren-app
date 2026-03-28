'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ArrowRight, Search, Brain, Bell, Clock, Sparkles, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export default function OnboardingCompletePage() {
  const router = useRouter()
  const [integrations, setIntegrations] = useState<string[]>([])
  const [initializing, setInitializing] = useState(true)
  const [onboardingMarked, setOnboardingMarked] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncProgress, setSyncProgress] = useState({ slackDone: false, outlookDone: false, commitments: 0 })
  const backfillTriggered = useRef(false)

  const supabase = createClient()

  useEffect(() => {
    loadOnboardingData()
  }, [supabase])

  const triggerBackfill = async (providers: string[]) => {
    if (backfillTriggered.current) return
    backfillTriggered.current = true
    if (providers.length === 0) return

    setSyncStatus('syncing')

    const results = await Promise.allSettled([
      providers.includes('slack')
        ? fetch('/api/integrations/slack/backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ daysBack: 30 }),
          }).then(r => r.json())
        : Promise.resolve(null),
      providers.includes('outlook')
        ? fetch('/api/integrations/outlook/backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ daysBack: 30 }),
          }).then(r => r.json())
        : Promise.resolve(null),
    ])

    let totalCommitments = 0
    const slackResult = results[0]
    const outlookResult = results[1]

    if (slackResult.status === 'fulfilled' && slackResult.value?.summary) {
      totalCommitments += slackResult.value.summary.commitments_detected || 0
      setSyncProgress(prev => ({ ...prev, slackDone: true }))
    }
    if (outlookResult.status === 'fulfilled' && outlookResult.value?.summary) {
      totalCommitments += outlookResult.value.summary.commitments_detected || 0
      setSyncProgress(prev => ({ ...prev, outlookDone: true }))
    }

    setSyncProgress(prev => ({ ...prev, commitments: totalCommitments }))

    const anyFailed = results.some(r => r.status === 'rejected')
    setSyncStatus(anyFailed && totalCommitments === 0 ? 'error' : 'done')
  }

  const loadOnboardingData = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        router.push('/signup')
        return
      }

      // Check integrations — try API first, fallback to client-side
      let providers: string[] = []
      try {
        const intRes = await fetch('/api/integrations/status', { cache: 'no-store' })
        if (intRes.ok) {
          const intData = await intRes.json()
          providers = (intData.integrations || []).map((i: any) => i.provider)
        }
      } catch { /* fall through */ }

      if (providers.length === 0) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('current_team_id')
          .eq('id', authData.user.id)
          .single()
        if (profile?.current_team_id) {
          const { data: intData } = await supabase
            .from('integrations')
            .select('provider')
            .eq('team_id', profile.current_team_id)
            .eq('user_id', authData.user.id)
          providers = (intData || []).map((i: any) => i.provider)
        }
      }
      setIntegrations(providers)

      // Mark onboarding as completed — try both API and direct client-side update
      let marked = false

      // Try API first
      try {
        const completeRes = await fetch('/api/onboarding/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: authData.user.id }),
        })
        if (completeRes.ok) marked = true
      } catch { /* fall through */ }

      // Direct client-side update as fallback
      if (!marked) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true, onboarding_step: 'complete' })
          .eq('id', authData.user.id)
      }
      setOnboardingMarked(true)
      setInitializing(false)

      // Auto-trigger backfill for connected integrations
      if (providers.length > 0) {
        triggerBackfill(providers)
      }
    } catch (err) {
      console.error('Error loading onboarding data:', err)
      setInitializing(false)
    }
  }

  if (initializing) {
    return (
      <div className="text-center">
        <p className="text-gray-500">Setting up your workspace...</p>
      </div>
    )
  }

  const getSlackStatus = () => {
    return integrations.includes('slack') ? 'Connected' : 'Not connected'
  }

  const getOutlookStatus = () => {
    return integrations.includes('outlook') ? 'Connected' : 'Not connected'
  }

  const getStepStatus = (step: 'scan' | 'detect' | 'score') => {
    if (syncStatus === 'idle') return 'pending'
    if (syncStatus === 'error') return 'error'
    if (syncStatus === 'done') return 'done'
    // syncing
    if (step === 'scan') return syncProgress.slackDone || syncProgress.outlookDone ? 'done' : 'active'
    if (step === 'detect') return syncProgress.commitments > 0 ? 'done' : (syncProgress.slackDone || syncProgress.outlookDone ? 'active' : 'pending')
    if (step === 'score') return 'pending'
    return 'pending'
  }

  return (
    <div className="space-y-8">
      {/* Celebration Icon */}
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 bg-gradient-to-r from-green-100 to-emerald-100 rounded-full animate-pulse" />
            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900">You&apos;re all set!</h2>
          <p className="text-lg text-gray-600">
            {syncStatus === 'done'
              ? `Wren found ${syncProgress.commitments} commitment${syncProgress.commitments !== 1 ? 's' : ''} in your messages.`
              : syncStatus === 'syncing'
              ? 'Wren is scanning your messages now...'
              : 'Wren is getting ready to scan your messages.'}
          </p>
        </div>
      </div>

      {/* Real Progress Steps */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          <h3 className="font-semibold text-gray-900">
            {syncStatus === 'done' ? 'Initial scan complete' : 'Processing your messages'}
          </h3>
        </div>
        <div className="space-y-3">
          {[
            { key: 'scan' as const, icon: Search, color: 'indigo', label: 'Scanning your recent messages', desc: 'Reading through Slack conversations and emails' },
            { key: 'detect' as const, icon: Brain, color: 'violet', label: 'Detecting commitments', desc: syncProgress.commitments > 0 ? `Found ${syncProgress.commitments} commitments so far` : 'Using AI to find commitments and follow-ups' },
            { key: 'score' as const, icon: Bell, color: 'amber', label: 'Setting up smart alerts', desc: 'Configuring nudges so you never miss a follow-up' },
          ].map(({ key, icon: Icon, color, label, desc }) => {
            const status = getStepStatus(key)
            return (
              <div key={key} className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  status === 'done' ? 'bg-green-50' : `bg-${color}-50`
                }`}>
                  {status === 'done'
                    ? <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
                    : <Icon className={`w-4 h-4 text-${color}-600`} aria-hidden="true" />}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${status === 'done' ? 'text-green-700' : 'text-gray-900'}`}>{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <div className="flex-shrink-0">
                  {status === 'active' && <div className={`w-5 h-5 border-2 border-${color}-600 border-t-transparent rounded-full animate-spin`} />}
                  {status === 'done' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                  {status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Status Message */}
      <div className={`border rounded-xl p-5 ${
        syncStatus === 'done'
          ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
          : syncStatus === 'error'
          ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
          : 'bg-gradient-to-r from-indigo-50 to-violet-50 border-indigo-200'
      }`}>
        <div className="flex items-center gap-3">
          <Clock className={`w-5 h-5 flex-shrink-0 ${
            syncStatus === 'done' ? 'text-green-600' : syncStatus === 'error' ? 'text-red-600' : 'text-indigo-600'
          }`} aria-hidden="true" />
          <div>
            {syncStatus === 'done' ? (
              <>
                <p className="font-semibold text-green-900">
                  {syncProgress.commitments > 0
                    ? 'Your dashboard is ready!'
                    : 'Initial scan complete — more results will appear as Wren processes additional messages.'}
                </p>
                <p className="text-sm text-green-700 mt-1">
                  {syncProgress.commitments > 0
                    ? 'Head to your dashboard to see your commitments, follow-ups, and action items.'
                    : 'Click "Sync History" on the Data Sync page for a deeper scan, or wait for results to appear over the next hour.'}
                </p>
              </>
            ) : syncStatus === 'error' ? (
              <>
                <p className="font-semibold text-red-900">Something went wrong during the initial scan</p>
                <p className="text-sm text-red-700 mt-1">
                  Don&apos;t worry — head to your dashboard and use the Data Sync page to retry.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-indigo-900">Wren is processing your messages now</p>
                <p className="text-sm text-indigo-700 mt-1">
                  This typically takes 2-5 minutes. You can go to your dashboard now — results will appear automatically.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Setup Summary</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Slack */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-base font-bold text-blue-600">S</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">Slack</p>
              <p className="text-sm text-gray-600">{getSlackStatus()}</p>
            </div>
            {integrations.includes('slack') && (
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            )}
          </div>

          {/* Outlook */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-base font-bold text-blue-700">O</span>
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">Outlook</p>
              <p className="text-sm text-gray-600">{getOutlookStatus()}</p>
            </div>
            {integrations.includes('outlook') && (
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            )}
          </div>
        </div>
      </div>

      {/* CTA Button — use hard navigation so middleware sees updated onboarding_completed */}
      <button
        onClick={() => window.location.href = '/'}
        disabled={!onboardingMarked}
        className="w-full py-4 px-4 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 text-base disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          boxShadow: '0 8px 24px rgba(79, 70, 229, 0.3)',
        }}
      >
        {onboardingMarked ? 'Go to Your Dashboard' : 'Finishing setup...'}
        <ArrowRight className="w-5 h-5" />
      </button>

      {/* Additional Resources */}
      <div className="text-center space-y-4">
        <p className="text-sm text-gray-600">Need to adjust anything?</p>
        <div className="flex flex-col gap-2 text-sm">
          <Link
            href="/integrations"
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Manage Integrations
          </Link>
          <Link
            href="/settings"
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
