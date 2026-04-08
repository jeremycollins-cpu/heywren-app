'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Zap, AlertCircle, Shield, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

interface Integration {
  id: string
  provider: string
}

const OUTLOOK_ADMIN_CONSENT_URL = `https://login.microsoftonline.com/common/adminconsent?client_id=${process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || '328441fc-bec2-4dcc-a9b6-0910b84d3ffe'}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai')}`

function OnboardingITGuide({ showSlack, showOutlook }: { showSlack: boolean; showOutlook: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    toast.success(`${label} copied!`)
    setTimeout(() => setCopied(null), 3000)
  }

  const tools = [showSlack && 'Slack', showOutlook && 'Outlook'].filter(Boolean).join(' or ')

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 text-left"
      >
        <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-blue-900 text-sm">Need admin approval to connect {tools}?</p>
          <p className="text-xs text-blue-700 mt-1">
            Most organizations require a workspace or IT admin to approve new apps. This is normal — click here to see how it works.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-blue-600 flex-shrink-0 mt-1" />
        ) : (
          <ChevronDown className="w-4 h-4 text-blue-600 flex-shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 ml-4 sm:ml-8 space-y-5">
          {/* General Steps */}
          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="text-sm font-medium text-blue-900">Click &quot;Connect&quot; on Slack or Outlook above</p>
                <p className="text-xs text-blue-700 mt-0.5">You&apos;ll be redirected to the service&apos;s authorization page</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="text-sm font-medium text-blue-900">If you see &quot;Approval required&quot; or &quot;Request to install&quot; — submit the request</p>
                <p className="text-xs text-blue-700 mt-0.5">Add a message like: &quot;I need HeyWren to track my commitments and follow-ups.&quot; Your admin will be notified automatically.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 text-blue-800 flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="text-sm font-medium text-blue-900">Once approved, come back and click &quot;Connect&quot; again</p>
                <p className="text-xs text-blue-700 mt-0.5">You can skip this step for now and add integrations later from Settings → Integrations</p>
              </div>
            </div>
          </div>

          {/* Slack-specific guidance */}
          {showSlack && (
            <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: '#4A154B' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="white"/></svg>
                </div>
                <p className="text-xs font-semibold text-blue-900">For Slack workspace admins</p>
              </div>
              <p className="text-xs text-blue-700">
                A Slack workspace admin needs to approve HeyWren in <strong>Slack Admin Dashboard → Manage Apps</strong>. Once approved, all workspace members can connect.
              </p>
            </div>
          )}

          {/* Outlook-specific guidance */}
          {showOutlook && (
            <div className="bg-white border border-blue-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: '#0078D4' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M24 7.387v10.478c0 .23-.08.424-.238.583a.793.793 0 01-.584.238h-8.322V6.566h8.322c.228 0 .422.08.584.238.159.16.238.353.238.583z" fill="white"/></svg>
                </div>
                <p className="text-xs font-semibold text-blue-900">For Microsoft 365 / IT admins</p>
              </div>
              <p className="text-xs text-blue-700">
                Share this link with your IT admin to approve HeyWren for your entire organization. We only need <strong>read-only</strong> access — we never send emails or modify calendars.
              </p>
              <button
                onClick={() => copyToClipboard(OUTLOOK_ADMIN_CONSENT_URL, 'Admin consent link')}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 border border-blue-300 rounded-lg text-xs font-medium text-blue-900 transition"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied === 'Admin consent link' ? 'Copied!' : 'Copy link for IT admin'}
              </button>
            </div>
          )}

          <div className="bg-blue-100/50 rounded-lg p-3">
            <p className="text-xs text-blue-800">
              <strong>What permissions does HeyWren need?</strong> Read-only access to your messages, email, and calendar so we can detect commitments and follow-ups. We never send messages, emails, or modify your calendar on your behalf.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function IntegrationsSetupContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [skipped, setSkipped] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    checkIntegrations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const checkIntegrations = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        router.push('/signup')
        return
      }

      // Show toasts from URL params
      const slackParam = searchParams.get('slack')
      const outlookParam = searchParams.get('outlook')

      if (slackParam === 'error') {
        toast.error('Slack connection failed. Please try again.')
      }
      if (outlookParam === 'error') {
        toast.error('Outlook connection failed. Please try again.')
      }

      // Fetch real integration status from DB — retry up to 3 times for just-completed OAuth
      const justConnected = slackParam === 'connected' || outlookParam === 'connected'
      let fetched: Integration[] = []
      const maxAttempts = justConnected ? 3 : 1

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Small delay on retries to let DB write propagate
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000))

        try {
          const res = await fetch('/api/integrations/status', { cache: 'no-store' })
          if (res.ok) {
            const data = await res.json()
            fetched = data.integrations?.map((i: any) => ({ id: i.id, provider: i.provider })) || []
          }
        } catch { /* fall through */ }

        // Client-side fallback if server-side session fails
        if (fetched.length === 0) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('current_team_id')
            .eq('id', authData.user.id)
            .single()
          if (profile?.current_team_id) {
            const { data: intData } = await supabase
              .from('integrations')
              .select('id, provider')
              .eq('team_id', profile.current_team_id)
              .eq('user_id', authData.user.id)
            fetched = (intData || []).map((i: any) => ({ id: i.id, provider: i.provider }))
          }
        }

        // If we found the just-connected integration, stop retrying
        const found = (slackParam === 'connected' && fetched.some(i => i.provider === 'slack'))
          || (outlookParam === 'connected' && fetched.some(i => i.provider === 'outlook'))
          || !justConnected
        if (found || fetched.length > 0) break
      }

      // Show success toasts only if integration is actually confirmed in DB
      if (slackParam === 'connected' && fetched.some(i => i.provider === 'slack')) {
        toast.success('Slack connected successfully!')
      } else if (slackParam === 'connected') {
        toast.error('Slack connection could not be confirmed. Please try again.')
      }
      if (outlookParam === 'connected' && fetched.some(i => i.provider === 'outlook')) {
        toast.success('Outlook connected successfully!')
      } else if (outlookParam === 'connected') {
        toast.error('Outlook connection could not be confirmed. Please try again.')
      }

      setIntegrations(fetched)
      setChecking(false)
    } catch (err) {
      console.error('Error checking integrations:', err)
      setIntegrations([])
      setChecking(false)
    }
  }

  const handleSlackConnect = async () => {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user) {
      toast.error('Please sign in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/connect`
    const state = btoa(JSON.stringify({ userId: authData.user.id, redirect: 'onboarding' }))
    const scopes = [
      'channels:read',
      'channels:history',
      'channels:join',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'mpim:read',
      'mpim:history',
      'chat:write',
      'users:read',
      'team:read',
    ].join(',')

    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
    window.location.href = authUrl
  }

  const handleOutlookConnect = async () => {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user) {
      toast.error('Please sign in first')
      return
    }

    const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`
    const state = btoa(JSON.stringify({ userId: authData.user.id, redirect: 'onboarding' }))
    const scopes = [
      'openid',
      'profile',
      'email',
      'Mail.Read',
      'Calendars.ReadWrite',
      'User.Read',
      'offline_access',
    ].join(' ')

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}&response_mode=query`
    window.location.href = authUrl
  }

  const handleContinue = async () => {
    if (integrations.length === 0 && !skipped) {
      toast.error('Please connect at least one integration to get started')
      return
    }

    if (skipped && integrations.length === 0) {
      toast('HeyWren works best with at least one integration connected. You can add them later in settings.', { icon: '⚠️' })
    }

    setLoading(true)

    try {
      router.push('/onboarding/channels')
    } catch (err) {
      console.error('Error:', err)
      setLoading(false)
    }
  }

  const isSlackConnected = integrations.some((i) => i.provider === 'slack')
  const isOutlookConnected = integrations.some((i) => i.provider === 'outlook')

  if (checking) {
    return (
      <div className="text-center">
        <p className="text-gray-500">Loading integrations...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Step Indicator */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600">
          <Zap className="w-6 h-6" />
        </div>
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 2 of 4 — Most Important
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Connect your tools</h2>
        <p className="text-gray-500 max-w-lg mx-auto text-sm">
          HeyWren monitors your conversations to detect commitments. Connect at least one tool to get started.
        </p>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Slack Card */}
        <div className={`relative rounded-xl border-2 transition-all p-6 flex flex-col ${
          isSlackConnected
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md'
        }`}>
          <div className="absolute -top-3 left-6">
            <span className="inline-flex items-center gap-1 text-white text-xs font-bold px-3 py-1 rounded-full" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
              Recommended
            </span>
          </div>

          <div className="flex-1 space-y-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: '#4A154B' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="white"/>
              </svg>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900">Slack</h3>
              <p className="text-sm text-gray-500 mt-2">
                Monitor channels for commitments, send nudges, and get daily digests directly in Slack
              </p>
            </div>

            {isSlackConnected && (
              <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Connected
              </div>
            )}
          </div>

          <button
            onClick={handleSlackConnect}
            disabled={isSlackConnected || loading}
            className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mt-4 ${
              isSlackConnected
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'text-white disabled:opacity-50'
            }`}
            style={!isSlackConnected ? {
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
            } : undefined}
          >
            {isSlackConnected ? 'Connected' : 'Connect Slack'}
          </button>
        </div>

        {/* Outlook Card */}
        <div className={`relative rounded-xl border-2 transition-all p-6 flex flex-col ${
          isOutlookConnected
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md'
        }`}>
          <div className="flex-1 space-y-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: '#0078D4' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M24 7.387v10.478c0 .23-.08.424-.238.583a.793.793 0 01-.584.238h-8.322V6.566h8.322c.228 0 .422.08.584.238.159.16.238.353.238.583zm-10.903-2.58v14.387L0 16.454V7.546l13.097-2.74z" fill="white"/>
                <path d="M8.322 9.652a3.045 3.045 0 00-1.194.242 3.077 3.077 0 00-1.015.675 3.131 3.131 0 00-.686 1.025 3.157 3.157 0 00-.25 1.253c0 .434.084.845.25 1.234.167.388.396.727.686 1.017.29.29.627.517 1.015.682.387.165.78.248 1.178.248.398 0 .79-.083 1.177-.248a3.098 3.098 0 001.016-.682c.29-.29.519-.629.686-1.017a3.072 3.072 0 00.25-1.234c0-.44-.083-.855-.25-1.253a3.132 3.132 0 00-.686-1.025 3.077 3.077 0 00-1.016-.675 3.023 3.023 0 00-1.161-.242zm0 4.986a1.807 1.807 0 01-1.312-.543 1.835 1.835 0 01-.547-1.343c0-.526.182-.974.547-1.343a1.807 1.807 0 011.312-.543c.511 0 .949.181 1.312.543.364.369.547.817.547 1.343s-.183.974-.547 1.343a1.807 1.807 0 01-1.312.543z" fill="white"/>
              </svg>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900">Outlook</h3>
              <p className="text-sm text-gray-500 mt-2">
                Track email commitments, calendar follow-ups, and meeting action items from Microsoft 365
              </p>
            </div>

            {isOutlookConnected && (
              <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Connected
              </div>
            )}
          </div>

          <button
            onClick={handleOutlookConnect}
            disabled={isOutlookConnected || loading}
            className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all mt-4 ${
              isOutlookConnected
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'text-white disabled:opacity-50'
            }`}
            style={!isOutlookConnected ? {
              background: '#0078D4',
            } : undefined}
          >
            {isOutlookConnected ? 'Connected' : 'Connect Outlook'}
          </button>
        </div>
      </div>

      {/* IT Approval Guidance */}
      {(!isSlackConnected || !isOutlookConnected) && (
        <OnboardingITGuide showSlack={!isSlackConnected} showOutlook={!isOutlookConnected} />
      )}

      {/* Warning if no integrations */}
      {integrations.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-900">At least one integration is needed</p>
            <p className="text-sm text-amber-800 mt-1">
              HeyWren can&apos;t detect commitments without access to Slack or Outlook. Connect one to get the most out of HeyWren.
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4 pt-2">
        <button
          onClick={handleContinue}
          disabled={loading || integrations.length === 0}
          className="flex-1 py-2.5 px-4 text-white font-semibold text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
          }}
        >
          {loading ? 'Continuing...' : 'Continue'}
        </button>

        {integrations.length === 0 && (
          <button
            onClick={() => {
              setSkipped(true)
              setTimeout(() => {
                router.push('/onboarding/channels')
              }, 100)
            }}
            disabled={loading}
            className="px-6 py-2.5 text-gray-500 font-medium text-sm hover:text-gray-700 transition"
          >
            Skip for now
          </button>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-800">
        <p className="font-semibold mb-1">Why integrations matter</p>
        <p className="text-indigo-700">HeyWren reads your Slack messages and Outlook emails to automatically find commitments. The more data it has, the better it detects and tracks your follow-through.</p>
      </div>
    </div>
  )
}

export default function IntegrationsSetupPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>}>
      <IntegrationsSetupContent />
    </Suspense>
  )
}
