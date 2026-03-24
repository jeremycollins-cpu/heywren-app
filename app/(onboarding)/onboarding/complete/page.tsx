'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, ArrowRight, Search, Brain, Bell, Clock, Sparkles } from 'lucide-react'
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

      // Mark onboarding as completed
      await supabase
        .from('profiles')
        .update({
          onboarding_completed: true,
          onboarding_step: 'complete',
          updated_at: new Date().toISOString(),
        })
        .eq('id', authData.user.id)

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
            <div className="absolute inset-0 bg-gradient-to-r from-green-100 to-emerald-100 rounded-full animate-pulse" />
            <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-4xl font-bold text-gray-900">You&apos;re all set!</h2>
          <p className="text-lg text-gray-600">
            Wren is now working in the background to find your commitments.
          </p>
        </div>
      </div>

      {/* What Wren is Doing Right Now */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          <h3 className="font-semibold text-gray-900">What Wren is doing right now</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <Search className="w-4 h-4 text-indigo-600" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Scanning your recent messages</p>
              <p className="text-xs text-gray-500">Looking through Slack conversations and emails for commitments</p>
            </div>
            <div className="flex-shrink-0">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
              <Brain className="w-4 h-4 text-violet-600" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Building your profile</p>
              <p className="text-xs text-gray-500">Learning your communication patterns and commitments style</p>
            </div>
            <div className="flex-shrink-0">
              <div className="w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
              <Bell className="w-4 h-4 text-amber-600" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Setting up smart alerts</p>
              <p className="text-xs text-gray-500">Configuring nudges so you never miss a follow-up</p>
            </div>
            <div className="flex-shrink-0">
              <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-200 rounded-xl p-5">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-indigo-600 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-indigo-900">Within the next hour, Wren will surface your first commitments</p>
            <p className="text-sm text-indigo-700 mt-1">
              Head to your dashboard now — results will appear as Wren processes your messages. The more integrations you connect, the more complete your picture will be.
            </p>
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

      {/* CTA Button */}
      <Link
        href="/"
        className="w-full py-4 px-4 text-white font-semibold rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 text-base"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          boxShadow: '0 8px 24px rgba(79, 70, 229, 0.3)',
        }}
      >
        Go to Your Dashboard
        <ArrowRight className="w-5 h-5" />
      </Link>

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
