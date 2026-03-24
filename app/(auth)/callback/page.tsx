// app/(auth)/callback/page.tsx
// Post-Stripe checkout callback v3 — bulletproof
// Calls server-side provisioning → handles both join and create flows
// No sessionStorage dependency — Stripe session metadata is the source of truth

'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [statusMessage, setStatusMessage] = useState('Setting up your account...')
  const [error, setError] = useState<string | null>(null)
  const provisioning = useRef(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    // Prevent double-execution in React strict mode
    if (provisioning.current) return
    provisioning.current = true

    const processCheckout = async () => {
      try {
        const sessionId = searchParams.get('session_id')
        if (!sessionId) {
          throw new Error('Missing checkout session. Please try signing up again.')
        }

        // Step 1: Provision the account server-side
        setStatusMessage('Verifying your payment...')

        const response = await fetch('/api/auth/provision-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Account setup failed')
        }

        // Step 2: Show contextual success message
        if (result.flow === 'joined') {
          setStatusMessage('You\'ve been added to your team!')
        } else if (result.alreadyProvisioned) {
          setStatusMessage('Welcome back!')
        } else {
          setStatusMessage('Your team is ready!')
        }

        // Step 3: Try to establish a client-side session
        const { data: sessionData } = await supabase.auth.getSession()

        if (sessionData?.session) {
          // Active session — redirect to onboarding
          setStatus('success')
          toast.success(
            result.flow === 'joined'
              ? 'Welcome to the team!'
              : result.alreadyProvisioned
                ? 'Welcome back!'
                : 'Account created successfully!'
          )

          // Clean up any sessionStorage leftovers
          try {
            sessionStorage.removeItem('signupUserId')
            sessionStorage.removeItem('signupEmail')
            sessionStorage.removeItem('selectedPlan')
            sessionStorage.removeItem('tempTeamId')
            sessionStorage.removeItem('companyName')
            sessionStorage.removeItem('joiningTeamId')
            sessionStorage.removeItem('joiningTeamName')
          } catch (e) {}

          setTimeout(() => router.push('/onboarding/profile'), 800)
          return
        }

        // Step 4: No session — user needs to sign in manually
        // (happens if email confirmation was required or Stripe opened new tab)
        setStatus('success')
        setStatusMessage('Account created! Please sign in to continue.')
        toast.success('Your account is ready! Please sign in.')

        setTimeout(() => router.push('/login?setup=complete'), 1500)

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred'
        console.error('Callback error:', err)
        setStatus('error')
        setError(errorMsg)
        toast.error(errorMsg)
      }
    }

    processCheckout()
  }, [router, searchParams, supabase])

  return (
    <div className="w-full space-y-6" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 3 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
          {status === 'error' ? 'Something went wrong' : 'Setting up your account'}
        </h2>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }} />
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }} />
        <div className={`flex-1 h-1 rounded-full ${status === 'success' ? '' : 'bg-gray-200'}`}
          style={status === 'success' ? { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' } : undefined}
        />
      </div>

      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 text-sm">{statusMessage}</p>
        </div>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-gray-900 font-semibold text-lg">{statusMessage}</p>
          <p className="text-gray-500 text-sm mt-2">Redirecting you now...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="text-red-800 font-medium">Setup failed</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStatus('loading')
                setStatusMessage('Retrying...')
                setError(null)
                provisioning.current = false
                window.location.reload()
              }}
              className="flex-1 px-4 py-2.5 text-white font-semibold rounded-lg text-sm transition"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => router.push('/login')}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg text-sm hover:bg-gray-50 transition"
            >
              Go to Login
            </button>
          </div>

          <p className="text-center text-xs text-gray-400">
            If this persists, contact{' '}
            <a href="mailto:support@heywren.ai" className="text-indigo-600 hover:underline">support@heywren.ai</a>
          </p>
        </div>
      )}
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
          <p className="text-gray-600">Please wait...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  )
}
