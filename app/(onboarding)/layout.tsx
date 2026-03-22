'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChevronRight } from 'lucide-react'
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50">
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-300"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">HW</span>
            </div>
            <span className="font-bold text-gray-900 group-hover:text-indigo-600 transition">HeyWren</span>
          </Link>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium text-gray-900">{currentStep}</span>
            <span>/</span>
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
