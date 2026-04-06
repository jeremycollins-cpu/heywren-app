'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'

export default function MfaVerifyPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || code.length !== 6) {
      toast.error('Please enter a 6-digit code')
      return
    }
    setLoading(true)
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totpFactor = factors?.totp?.[0]
      if (!totpFactor) {
        toast.error('No 2FA factor found')
        return
      }

      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: totpFactor.id,
      })
      if (challengeError) throw challengeError

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totpFactor.id,
        challengeId: challengeData.id,
        code,
      })
      if (verifyError) throw verifyError

      toast.success('Verified!')
      router.push('/')
    } catch {
      toast.error('Invalid code. Please try again.')
      setCode('')
    }
    setLoading(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto mb-4 bg-indigo-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Two-Factor Authentication</h2>
        <p className="text-gray-500 mt-2 text-sm">Enter the 6-digit code from your authenticator app</p>
      </div>

      <form onSubmit={handleVerify} className="space-y-4">
        <div>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            autoFocus
            className="w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900"
          />
        </div>
        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="w-full px-4 py-2.5 text-white font-semibold rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', boxShadow: '0 4px 16px rgba(79, 70, 229, 0.2)' }}
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>

      <div className="text-center">
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-700 transition"
        >
          Use a different account
        </button>
      </div>
    </div>
  )
}
