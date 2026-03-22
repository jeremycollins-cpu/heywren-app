'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Zap, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Integration {
  id: string
  provider: string
}

export default function IntegrationsSetupPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [skipped, setSkipped] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    checkIntegrations()
  }, [searchParams])

  const checkIntegrations = async () => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        router.push('/signup')
        return
      }

      // Get user's current team
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', authData.user.id)
        .single()

      if (!profile?.current_team_id) {
        setIntegrations([])
        setChecking(false)
        return
      }

      const { data: integrations } = await supabase
        .from('integrations')
        .select('id, provider')
        .eq('team_id', profile.current_team_id)

      setIntegrations(integrations || [])
      setChecking(false)

      // Show success toasts
      if (searchParams.get('slack') === 'connected') {
        toast.success('Slack connected successfully!')
      }
      if (searchParams.get('outlook') === 'connected') {
        toast.success('Outlook connected successfully!')
      }
    } catch (err) {
      console.error('Error checking integrations:', err)
      setChecking(false)
    }
  }

  const handleSlackConnect = () => {
    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/slack/connect?redirect=onboarding`
    const scopes = [
      'chat:write',
      'channels:read',
      'users:read',
      'team:read',
      'emoji:read',
    ].join(',')

    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`
    window.location.href = authUrl
  }

  const handleOutlookConnect = () => {
    const clientId = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || ''
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/integrations/outlook/connect`
    const state = Buffer.from(JSON.stringify({ redirect: 'onboarding' })).toString('base64')
    const scopes = [
      'openid',
      'profile',
      'email',
      'Mail.Read',
      'Calendars.Read',
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
        <h2 className="text-3xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Connect your tools</h2>
        <p className="text-gray-500 max-w-lg mx-auto text-sm">
          HeyWren monitors your conversations to detect commitments. Connect at least one tool to get started.
        </p>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

      {/* Warning if no integrations */}
      {integrations.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-900">At least one integration is needed</p>
            <p className="text-sm text-amber-800 mt-1">
              HeyWren can't detect commitments without access to Slack or Outlook. Connect one to get the most out of HeyWren.
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
