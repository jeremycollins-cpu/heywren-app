'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    const processCheckout = async () => {
      try {
        const sessionId = searchParams.get('session_id')
        if (!sessionId) {
          throw new Error('Missing session ID')
        }

        // Get current user
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) {
          throw new Error('Not authenticated')
        }

        // Get session details from Stripe
        // Note: In production, you'd verify this server-side for security
        // For now, we're assuming webhook has already processed it

        // Get user info from signup
        const signupUserId = sessionStorage.getItem('signupUserId')
        const signupEmail = sessionStorage.getItem('signupEmail')
        const selectedPlan = sessionStorage.getItem('selectedPlan') as 'starter' | 'pro'
        const tempTeamId = sessionStorage.getItem('tempTeamId')

        if (!signupEmail) {
          throw new Error('Missing signup information')
        }

        // Create team
        const teamName = sessionStorage.getItem('companyName') || 'My Team'
        const { data: newTeam, error: teamError } = await supabase
          .from('teams')
          .insert([
            {
              name: teamName,
              slug: `team-${Date.now()}`,
            },
          ])
          .select()
          .single()

        if (teamError || !newTeam) {
          throw new Error('Failed to create team')
        }

        // Add user as super_admin of team
        const { error: memberError } = await supabase
          .from('team_members')
          .insert([
            {
              team_id: newTeam.id,
              user_id: userData.user.id,
              role: 'owner',
            },
          ])

        if (memberError) {
          throw new Error('Failed to add user to team')
        }

        // Update user profile with role and team
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            role: 'super_admin',
            current_team_id: newTeam.id,
          })
          .eq('id', userData.user.id)

        if (profileError) {
          throw new Error('Failed to update profile')
        }

        // Clean up session storage
        sessionStorage.removeItem('signupUserId')
        sessionStorage.removeItem('signupEmail')
        sessionStorage.removeItem('selectedPlan')
        sessionStorage.removeItem('tempTeamId')
        sessionStorage.removeItem('companyName')

        toast.success('Welcome to HeyWren!')
        // Redirect to onboarding flow to set up integrations
        router.push('/onboarding/profile')
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('Callback error:', err)
        setError(errorMsg)
        toast.error(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    processCheckout()
  }, [router, searchParams, supabase])

  return (
    <div className="w-full space-y-6">
      <div className="text-center">
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium mb-2">
          Step 3 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900">Setting up your account</h2>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Please wait while we set up your account...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
          <button
            onClick={() => window.location.href = '/signup'}
            className="mt-4 btn-primary"
          >
            Try Again
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="w-full space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Setting up your account</h2>
        </div>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Please wait while we set up your account...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
