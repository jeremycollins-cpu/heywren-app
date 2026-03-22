'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WrenFullLogo } from '@/components/logo'
import Link from 'next/link'

interface OnboardingLayoutProps {
  children: React.ReactNode
}

export default function OnboardingLayout({ children }: OnboardingLayoutProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState(4)
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
    if (path.includes('profile')) setCurrentStep(1)
    else if (path.includes('integrations')) setCurrentStep(2)
    else if (path.includes('channels')) setCurrentStep(3)
    else if (path.includes('invite')) setCurrentStep(4)
    else if (path.includes('complete')) setCurrentStep(5)
  }, [])

  if (!isAuthenticated) {
    return null
  }

  const progressPercentage = (currentStep / totalSteps) * 100

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
            <span className="font-semibold text-gray-900">{currentStep}</span>
            <span className="text-gray-300">/</span>
            <span>{totalSteps}</span>
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
