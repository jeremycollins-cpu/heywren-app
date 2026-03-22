'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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
        sessionStorage.setItem('signupUserId', data.user.id)
        sessionStorage.setItem('signupEmail', email)
        toast.success('Account created! Choose your plan.')
        router.push('/signup/plan')
      }
    } catch (err) {
      toast.error('An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-5" style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
          Step 1 of 3
        </div>
        <h2 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>Create your account</h2>
        <p className="text-gray-500 mt-1.5 text-sm">Free during beta — no credit card required</p>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1.5">
        <div className="flex-1 h-1 rounded-full" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }} />
        <div className="flex-1 h-1 bg-gray-200 rounded-full" />
        <div className="flex-1 h-1 bg-gray-200 rounded-full" />
      </div>

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
          <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1.5">
            Company name
          </label>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="Acme Inc"
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
            required
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-gray-900 text-sm"
            placeholder="you@company.com"
          />
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
          {loading ? 'Creating account...' : 'Continue'}
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
