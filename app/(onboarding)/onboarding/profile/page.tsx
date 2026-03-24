'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, Briefcase } from 'lucide-react'
import toast from 'react-hot-toast'

const jobTitles = [
  'CEO / Founder',
  'VP / Executive',
  'Director',
  'Manager',
  'Individual Contributor',
  'Other',
]

const teamSizes = [
  { label: '1-5 people', value: '1-5' },
  { label: '6-15 people', value: '6-15' },
  { label: '16-50 people', value: '16-50' },
  { label: '51-200 people', value: '51-200' },
  { label: '200+ people', value: '200+' },
]

export default function ProfileSetupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [fullName, setFullName] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [initializing, setInitializing] = useState(true)

  const supabase = createClient()

  useEffect(() => {
    const loadUserData = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser()
        if (!authData?.user) {
          router.push('/signup')
          return
        }

        // Try full_name first, fall back to display_name (production may differ)
        let profile: any = null
        const { data: p1, error: e1 } = await supabase
          .from('profiles')
          .select('full_name, display_name, company')
          .eq('id', authData.user.id)
          .single()

        if (!e1) {
          profile = p1
        } else {
          // If columns are missing, try minimal select
          const { data: p2 } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .single()
          profile = p2
        }

        if (profile) {
          setFullName(profile.full_name || profile.display_name || '')
          setCompanyName(profile.company || '')
        }

        setInitializing(false)
      } catch (err) {
        console.error('Error loading user data:', err)
        setInitializing(false)
      }
    }

    loadUserData()
  }, [supabase, router])

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!fullName.trim()) {
      toast.error('Please enter your full name')
      return
    }

    if (!jobTitle) {
      toast.error('Please select your job title')
      return
    }

    if (!companyName.trim()) {
      toast.error('Please enter your company name')
      return
    }

    if (!teamSize) {
      toast.error('Please select your team size')
      return
    }

    setLoading(true)

    try {
      const { data: authData } = await supabase.auth.getUser()
      if (!authData?.user) {
        throw new Error('Not authenticated')
      }

      // Use the API route for the update — it runs with admin privileges
      // and avoids RLS or missing-column issues on the client.
      const response = await fetch('/api/onboarding/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          jobTitle,
          companyName,
          teamSize,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update profile')
      }

      toast.success('Profile updated!')
      router.push('/onboarding/integrations')
    } catch (err: any) {
      console.error('Error updating profile:', err)
      toast.error(err.message || 'Failed to update profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (initializing) {
    return (
      <div className="text-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Step Indicator */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600">
          <Briefcase className="w-6 h-6" />
        </div>
        <div className="inline-block bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium">
          Step 1 of 4
        </div>
        <h2 className="text-3xl font-bold text-gray-900">Let&apos;s set up your workspace</h2>
        <p className="text-gray-600 max-w-lg mx-auto">
          Tell us a bit about yourself so Wren can tailor follow-through to your role and team.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleContinue} className="space-y-6">
        {/* Full Name */}
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-1">
            Full Name
          </label>
          <p className="text-xs text-gray-500 mb-2">So teammates know who made each commitment</p>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900"
            placeholder="John Doe"
          />
        </div>

        {/* Job Title */}
        <div>
          <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700 mb-1">
            Job Title / Role
          </label>
          <p className="text-xs text-gray-500 mb-2">Wren prioritizes commitments relevant to your role</p>
          <select
            id="jobTitle"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900"
          >
            <option value="">Select your role</option>
            {jobTitles.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
        </div>

        {/* Company Name */}
        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1">
            Company Name
          </label>
          <p className="text-xs text-gray-500 mb-2">To match you with your team</p>
          <input
            id="companyName"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900"
            placeholder="Acme Inc"
          />
        </div>

        {/* Team Size */}
        <div>
          <label htmlFor="teamSize" className="block text-sm font-medium text-gray-700 mb-1">
            Team Size
          </label>
          <p className="text-xs text-gray-500 mb-2">Helps Wren calibrate the right level of nudging</p>
          <select
            id="teamSize"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition bg-white text-gray-900"
          >
            <option value="">Select team size</option>
            {teamSizes.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </div>

        {/* Continue Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium rounded-lg hover:from-indigo-700 hover:to-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? 'Saving...' : (
            <>
              Continue
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-800">
        <p className="font-medium mb-1">Why we ask this</p>
        <p>Wren uses your profile to prioritize the right commitments, calibrate nudge frequency for your team size, and personalize follow-through coaching to your role.</p>
      </div>
    </div>
  )
}
