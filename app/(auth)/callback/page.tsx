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

        const userId = sessionStorage.getItem('signupUserId')
        const email = sessionStorage.getItem('signupEmail')
        const companyName = sessionStorage.getItem('companyName')

        const response = await fetch('/api/auth/setup-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            userId,
            email,
            companyName,
          }),
        })

        const result = await response.json()

        if (!response.ok) {
          // Show full error details for debugging
          const details = result.details ? ` (${result.details})` : ''
          const hint = result.hint && result.hint !== 'none' ? ` Hint: ${result.hint}` : ''
          throw new Error(`${result.error || 'Failed to set up account'}${details}${hint}`)
        }

        sessionStorage.removeItem('signupUserId')
        sessionStorage.removeItem('signupEmail')
        sessionStorage.removeItem('selectedPlan')
        sessionStorage.removeItem('tempTeamId')
        sessionStorage.removeItem('companyName')

        const { data: sessionData } = await supabase.auth.getSession()

        if (sessionData?.session) {
          toast.success('Welcome to HeyWren!')
          router.push('/onboarding/profile')
        } else {
          toast.success('Account created! Please sign in to continue.')
          router.push('/login')
        }
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
    <div className="w-full max-w-md mx-auto space-y-6">
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
          <p className="text-red-800 text-sm break-words">{error}</p>
          <button
            onClick={() => window.location.href = '/signup'}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
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
      <div className="w-full max-w-md mx-auto space-y-6">
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
