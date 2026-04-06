'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'
import { Suspense } from 'react'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showMfaChallenge, setShowMfaChallenge] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        toast.error(error.message)
        return
      }

      // Check if MFA is required
      const { data: factorsData } = await supabase.auth.mfa.listFactors()
      const totpFactor = factorsData?.totp?.[0]

      if (totpFactor) {
        // User has 2FA enrolled — need to verify
        setShowMfaChallenge(true)
        setMfaFactorId(totpFactor.id)
        return // Don't navigate yet
      }

      toast.success('Logged in successfully!')

      // Check if user needs onboarding
      const needsOnboarding = searchParams.get('onboarding') === 'true'
        || localStorage.getItem('heywren_needs_onboarding') === 'true'

      if (needsOnboarding) {
        localStorage.removeItem('heywren_needs_onboarding')

        // Check integrations via server-side API (bypasses RLS)
        const intRes = await fetch('/api/integrations/status', { cache: 'no-store' })
        if (intRes.ok) {
          const intData = await intRes.json()
          if (!intData.integrations || intData.integrations.length === 0) {
            router.push('/onboarding/profile')
            return
          }
        }
      }

      // Check if user has completed onboarding even without the flag
      if (data?.user) {
        const intRes = await fetch('/api/integrations/status', { cache: 'no-store' })
        if (intRes.ok) {
          const intData = await intRes.json()
          if (!intData.integrations || intData.integrations.length === 0) {
            router.push('/onboarding/profile')
            return
          }
        }
      }

      router.push('/')
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleMfaVerify = async () => {
    if (!mfaFactorId || !mfaCode.trim()) return
    setMfaLoading(true)
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: mfaFactorId,
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      })
      if (verifyError) throw verifyError

      toast.success('Verified!')
      router.push('/')
    } catch {
      toast.error('Invalid code. Please try again.')
      setMfaCode('')
    }
    setMfaLoading(false)
  }

  if (showMfaChallenge) {
    return (
      <div className="w-full max-w-md mx-auto space-y-6" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Two-Factor Authentication</h2>
          <p className="text-gray-500 mt-2 text-sm">Enter the 6-digit code from your authenticator app</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            maxLength={6}
            pattern="[0-9]*"
            inputMode="numeric"
            autoFocus
            placeholder="000000"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-center text-xl tracking-widest font-mono"
          />
          <button
            onClick={handleMfaVerify}
            disabled={mfaLoading || mfaCode.length < 6}
            className="w-full px-4 py-2.5 text-white font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)' }}
          >
            {mfaLoading ? 'Verifying...' : 'Verify'}
          </button>
        </div>

        <div className="text-center">
          <button
            onClick={async () => {
              setShowMfaChallenge(false)
              setMfaFactorId(null)
              setMfaCode('')
              await supabase.auth.signOut()
            }}
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            Use a different account
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Welcome back</h2>
        <p className="text-gray-500 mt-2 text-sm">Sign in to your HeyWren account</p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm" placeholder="you@company.com" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
            <Link href="/login" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">Forgot password?</Link>
          </div>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm" placeholder="Enter your password" />
        </div>
        <button type="submit" disabled={loading} className="w-full px-4 py-2.5 text-white font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)' }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
        <div className="relative flex justify-center text-xs"><span className="px-3 bg-white text-gray-400">New to HeyWren?</span></div>
      </div>

      <Link href="/signup" className="block w-full px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 hover:border-gray-400 transition text-center text-sm">
        Create an Account
      </Link>

      <p className="text-center text-xs text-gray-400 mt-4">
        By signing in, you agree to our{' '}
        <a href="https://heywren.ai/terms" className="text-indigo-600 hover:underline">Terms</a>
        {' '}and{' '}
        <a href="https://heywren.ai/privacy" className="text-indigo-600 hover:underline">Privacy Policy</a>
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-md mx-auto space-y-6">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
