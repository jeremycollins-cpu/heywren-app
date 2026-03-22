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

      // If Slack just connected, show toast
      if (searchParams.get('slack') === 'connected') {
        toast.success('Slack connected successfully!')
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

    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}`

    window.location.href = authUrl
  }

  const handleOutlookConnect = () => {
    toast.error('Outlook integration coming soon!')
  }

  const handleContinue = async () => {
    if (integrations.length === 0 && !skipped) {
      toast.error('Please connect at least one integration to get started')
      return
    }

    if (skipped && integrations.length === 0) {
      toast.warning('HeyWren works best with at least one integration connected. You can add them later in settings.')
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
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium">
          Step 2 of 4
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Connect your tools</h2>
        <p className="text-gray-600 max-w-lg mx-auto">
          HeyWren monitors your conversations to detect commitments and help you follow through
        </p>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Slack Card */}
        <div className={`relative rounded-xl border-2 transition-all p-6 flex flex-col ${
          isSlackConnected
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
        }`}>
          {/* Recommended Badge */}
          <div className="absolute -top-3 left-6">
            <span className="inline-block bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">
              Recommended
            </span>
          </div>

          <div className="flex-1 space-y-4">
            {/* Logo */}
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>

            {/* Title and Description */}
            <div>
              <h3 className="text-lg font-bold text-gray-900">Slack</h3>
              <p className="text-sm text-gray-600 mt-2">
                Monitor channels for commitments, send nudges, and get daily digests directly in Slack
              </p>
            </div>

            {isSlackConnected && (
              <div className="flex items-center gap-2 text-green-700 font-medium">
                <CheckCircle2 className="w-5 h-5" />
                Connected
              </div>
            )}
          </div>

          {/* Button */}
          <button
            onClick={handleSlackConnect}
            disabled={isSlackConnected || loading}
            className={`w-full py-2 px-4 rounded-lg font-medium transition-all mt-4 ${
              isSlackConnected
                ? 'bg-green-100 text-green-700 cursor-default'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50'
            }`}
          >
            {isSlackConnected ? 'Connected' : 'Connect Slack'}
          </button>
        </div>

        {/* Outlook Card */}
        <div className={`relative rounded-xl border-2 transition-all p-6 flex flex-col ${
          isOutlookConnected
            ? 'border-green-300 bg-green-50'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
        }`}>
          {/* Coming Soon Badge */}
          <div className="absolute -top-3 left-6">
            <span className="inline-block bg-gray-400 text-white text-xs font-bold px-3 py-1 rounded-full">
              Coming Soon
            </span>
          </div>

          <div className="flex-1 space-y-4">
            {/* Logo */}
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">O</span>
            </div>

            {/* Title and Description */}
            <div>
              <h3 className="text-lg font-bold text-gray-900">Outlook</h3>
              <p className="text-sm text-gray-600 mt-2">
                Track email commitments, calendar follow-ups, and meeting action items
              </p>
            </div>

            {isOutlookConnected && (
              <div className="flex items-center gap-2 text-green-700 font-medium">
                <CheckCircle2 className="w-5 h-5" />
                Connected
              </div>
            )}
          </div>

          {/* Button */}
          <button
            onClick={handleOutlookConnect}
            disabled={true}
            className="w-full py-2 px-4 rounded-lg font-medium transition-all mt-4 bg-gray-100 text-gray-600 cursor-not-allowed"
          >
            Coming Soon
          </button>
        </div>
      </div>

      {/* Warning if skipping */}
      {integrations.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-yellow-900">At least one integration is required</p>
            <p className="text-sm text-yellow-800 mt-1">
              HeyWren can't detect commitments without Slack or Outlook. Connect one to get started.
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4 pt-4">
        <button
          onClick={handleContinue}
          disabled={loading || integrations.length === 0}
          className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Continuing...' : 'Continue'}
        </button>

        {integrations.length > 0 && (
          <button
            onClick={() => {
              setSkipped(false)
              handleContinue()
            }}
            disabled={loading}
            className="px-4 py-3 text-gray-600 font-medium hover:text-gray-900 transition"
          >
            Skip
          </button>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800">
        <p className="font-medium mb-1">Why integrations matter</p>
        <p>HeyWren uses your Slack and email data to find and track commitments. More data = better detection and AI insights.</p>
      </div>
    </div>
  )
}
