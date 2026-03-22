'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function OnboardingCompletePage() {
  const router = useRouter()
  const [integrations, setIntegrations] = useState<string[]>([])
  const [initializing, setInitializing] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    loadOnboardingData()
  }, [supabase])

  const loadOnboardingData = async () => {
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
        setInitializing(false)
        return
      }

      const { data: integrationData } = await supabase
        .from('integrations')
        .select('provider')
        .eq('team_id', profile.current_team_id)

      const providers = integrationData?.map((i) => i.provider) || []
      setIntegrations(providers)

      setInitializing(false)
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

  return (
    <div className="space-y-8">
      {/* Celebration Icon */}
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-100 to-violet-100 rounded-full animate-pulse" />
            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-4xl font-bold text-gray-900">You're all set!</h2>
          <p className="text-lg text-gray-600">
            Your workspace is ready. HeyWren is now monitoring for commitments.
          </p>
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

      {/* What Happens Next */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6 space-y-4">
        <h3 className="font-semibold text-indigo-900">What happens next?</h3>
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-indigo-900">AI Monitoring</p>
              <p className="text-sm text-indigo-800">HeyWren will scan your conversations for commitments</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-indigo-900">Smart Detection</p>
              <p className="text-sm text-indigo-800">Commitments appear on your dashboard in real-time</p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-indigo-900">Intelligent Nudges</p>
              <p className="text-sm text-indigo-800">Get reminders before deadlines miss in Slack or email</p>
            </div>
          </li>
        </ul>
      </div>

      {/* CTA Button */}
      <Link
        href="/dashboard"
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all flex items-center justify-center gap-2"
      >
        Go to Dashboard
        <ArrowRight className="w-4 h-4" />
      </Link>

      {/* Additional Resources */}
      <div className="text-center space-y-4">
        <p className="text-sm text-gray-600">Questions? Need help?</p>
        <div className="flex flex-col gap-2 text-sm">
          <Link
            href="/dashboard/integrations"
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Manage Integrations
          </Link>
          <Link
            href="/dashboard/settings"
            className="text-indigo-600 hover:text-indigo-700 font-medium"
          >
            View Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
