'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WrenFullLogo } from '@/components/logo'
import Link from 'next/link'

const TOTAL_STEPS = 4

const STEP_MAP: Record<string, number> = {
  profile: 1,
  integrations: 2,
  channels: 3,
  invite: 3,
  complete: 4,
}

interface OnboardingLayoutProps {
  children: React.ReactNode
}

export default function OnboardingLayout({ children }: OnboardingLayoutProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data?.session) {
        window.location.href = '/signup'
        return
      }
      setIsAuthenticated(true)
    }

    checkAuth()
  }, [supabase])

  // Extract step number from pathname
  useEffect(() => {
    const path = window.location.pathname
    for (const [key, step] of Object.entries(STEP_MAP)) {
      if (path.includes(key)) {
        setCurrentStep(step)
        break
      }
    }
  }, [])

  if (!isAuthenticated) {
    return null
  }

  const progressPercentage = (currentStep / TOTAL_STEPS) * 100

  return (
    <div className="min-h-screen" style={{ background: '#fafbfc', fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
        <div className="h-1 bg-gray-100">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercentage}%`, background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          />
        </div>
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <WrenFullLogo width={100} />
          </Link>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {currentStep > 0 && currentStep <= TOTAL_STEPS ? (
              <>
                <span className="font-semibold text-gray-900">Step {currentStep}</span>
                <span className="text-gray-300">of</span>
                <span>{TOTAL_STEPS}</span>
              </>
            ) : (
              <span className="font-semibold text-gray-900">Getting Started</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex items-center justify-center min-h-screen px-4 py-24">
        <div className="w-full max-w-2xl">
          {children}
        </div>
      </div>
    </div>
  )
}
