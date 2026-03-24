'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import Sidebar from '@/components/sidebar'
import Header from '@/components/header'
import Walkthrough, { useWalkthroughAutoStart } from '@/components/walkthrough'
import HelpPanel from '@/components/help-panel'

function OnboardingBanner({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter()

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle aria-hidden="true" className="w-5 h-5 text-amber-300 flex-shrink-0" />
          <p className="text-sm font-medium">
            <span className="font-semibold">Setup incomplete:</span> Connect Slack or Outlook to start capturing commitments automatically.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => router.push('/integrations')}
            className="flex items-center gap-1.5 bg-white text-indigo-700 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-indigo-50 transition"
          >
            Complete Setup
            <ArrowRight aria-hidden="true" className="w-4 h-4" />
          </button>
          <button
            onClick={onDismiss}
            className="text-indigo-200 hover:text-white transition"
            aria-label="Dismiss"
          >
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [helpPanelOpen, setHelpPanelOpen] = useState(false)
  const [showOnboardingBanner, setShowOnboardingBanner] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const shouldAutoStartWalkthrough = useWalkthroughAutoStart()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Check if user has integrations
  useEffect(() => {
    const checkIntegrations = async () => {
      try {
        const dismissed = sessionStorage.getItem('heywren_banner_dismissed')
        if (dismissed) {
          setBannerDismissed(true)
          return
        }

        const { data: integrations } = await supabase
          .from('integrations')
          .select('id')
          .limit(1)

        if (!integrations || integrations.length === 0) {
          setShowOnboardingBanner(true)
        }
      } catch (err) {
        console.error('Error checking integrations:', err)
      }
    }

    checkIntegrations()
  }, [supabase])

  // Auto-start walkthrough on first login
  useEffect(() => {
    if (shouldAutoStartWalkthrough) {
      setWalkthroughOpen(true)
    }
  }, [shouldAutoStartWalkthrough])

  const handleDismissBanner = () => {
    setBannerDismissed(true)
    setShowOnboardingBanner(false)
    sessionStorage.setItem('heywren_banner_dismissed', 'true')
  }

  const handleHelpClick = () => {
    setHelpPanelOpen(!helpPanelOpen)
  }

  const handleStartWalkthrough = () => {
    setWalkthroughOpen(true)
  }

  return (
    <div className="flex flex-col h-screen bg-surface-secondary dark:bg-surface-dark font-sans transition-colors duration-300">
      {/* Onboarding banner */}
      {showOnboardingBanner && !bannerDismissed && (
        <OnboardingBanner onDismiss={handleDismissBanner} />
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onHelpClick={handleHelpClick}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
          <main id="main-content" className="flex-1 overflow-auto">
            <div className="max-w-7xl mx-auto px-6 py-8">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Walkthrough */}
      <Walkthrough
        open={walkthroughOpen}
        onClose={() => setWalkthroughOpen(false)}
      />

      {/* Help Panel */}
      <HelpPanel
        open={helpPanelOpen}
        onClose={() => setHelpPanelOpen(false)}
        onStartWalkthrough={handleStartWalkthrough}
      />
    </div>
  )
}
