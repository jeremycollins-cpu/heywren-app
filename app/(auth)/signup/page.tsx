// app/(auth)/signup/page.tsx
// Signup page v2 — with domain-based team detection
// When user enters a work email, checks if their company already has a team
// Shows "You'll be joining [Company]!" banner if team exists

'use client'

import { useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'

interface TeamInfo {
  id: string
  name: string
  memberCount: number
}

interface DomainCheckResult {
  teamExists: boolean
  domain: string
  isPersonalEmail: boolean
  team?: TeamInfo
}

function SignupPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get('invite')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingDomain, setCheckingDomain] = useState(false)
  const [domainResult, setDomainResult] = useState<DomainCheckResult | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Debounced domain check when email field loses focus
  const checkDomain = useCallback(async (emailValue: string) => {
    if (!emailValue || !emailValue.includes('@') || emailValue.split('@')[1].length < 3) {
      setDomainResult(null)
      return
    }

    setCheckingDomain(true)
    try {
      const res = await fetch('/api/auth/check-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue }),
      })
      const data: DomainCheckResult = await res.json()
      setDomainResult(data)

      // If joining existing team, pre-fill company name
      if (data.teamExists && data.team) {
        setCompanyName(data.team.name)
      }
    } catch (err) {
      console.error('Domain check failed:', err)
      setDomainResult(null)
    } finally {
      setCheckingDomain(false)
    }
  }, [])

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    try {
      // Create the auth account
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            company_name: companyName,
          },
        },
      })

      if (error) {
        toast.error(error.message)
        return
      }

      if (data?.user) {
        // Store signup context for the plan page
        // These are used as fallbacks — the real source of truth is Stripe metadata
        try {
          sessionStorage.setItem('signupUserId', data.user.id)
          sessionStorage.setItem('signupEmail', email)
          sessionStorage.setItem('companyName', companyName)
          if (domainResult?.teamExists && domainResult.team) {
            sessionStorage.setItem('joiningTeamId', domainResult.team.id)
            sessionStorage.setItem('joiningTeamName', domainResult.team.name)
          }
        } catch (e) {
          // sessionStorage might not be available — that's okay
        }

        if (inviteToken) {
          // Invited user — skip billing, go accept the invite
          toast.success('Account created! Accepting your invitation...')
          router.push(`/invite/${inviteToken}`)
        } else {
          toast.success('Account created! Choose your plan.')
          router.push('/signup/plan')
        }
      }
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const isJoining = domainResult?.teamExists && domainResult.team

  return (
    <div className="w-full space-y-5" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 1 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Create your account</h2>
        <p className="text-gray-500 mt-1.5 text-sm">Start your 14-day free trial</p>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }} />
        <div className="flex-1 h-1 bg-gray-200 rounded-full" />
        <div className="flex-1 h-1 bg-gray-200 rounded-full" />
      </div>

      {/* Team detection banner */}
      {isJoining && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-emerald-800 font-semibold text-sm">{domainResult.team!.name} is already on HeyWren!</p>
            <p className="text-emerald-600 text-xs mt-0.5">
              You&apos;ll automatically join their team ({domainResult.team!.memberCount} {domainResult.team!.memberCount === 1 ? 'member' : 'members'})
            </p>
          </div>
        </div>
      )}

      {checkingDomain && (
        <div className="flex items-center gap-2 text-gray-400 text-xs px-1">
          <div className="w-3 h-3 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin"></div>
          Checking your organization...
        </div>
      )}

      <form onSubmit={handleSignup} className="space-y-3.5">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1.5">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Work email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={(e) => checkDomain(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="you@company.com"
          />
        </div>

        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1.5">
            Company name
          </label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            disabled={!!isJoining}
            className={`w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm ${isJoining ? 'bg-gray-50 text-gray-500' : ''}`}
            placeholder="Acme Inc"
          />
          {isJoining && (
            <p className="text-xs text-gray-400 mt-1">Auto-filled from your team</p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="Min. 6 characters"
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="Repeat your password"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2.5 text-white font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)',
          }}
        >
          {loading ? 'Creating account...' : isJoining ? `Join ${domainResult.team!.name}` : 'Continue'}
        </button>
      </form>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200"></div>
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-3 bg-white text-gray-400">
            Already have an account?
          </span>
        </div>
      </div>

      <Link
        href="/login"
        className="block w-full px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 hover:border-gray-400 transition text-center text-sm"
      >
        Sign In
      </Link>

      <p className="text-center text-xs text-gray-400">
        By creating an account, you agree to our{' '}
        <a href="https://heywren.ai/terms" className="text-indigo-600 hover:underline">Terms</a>
        {' '}and{' '}
        <a href="https://heywren.ai/privacy" className="text-indigo-600 hover:underline">Privacy Policy</a>
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full" /></div>}>
      <SignupPageInner />
    </Suspense>
  )
}
