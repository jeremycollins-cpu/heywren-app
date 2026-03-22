'use client'

import React, { useState, useEffect } from 'react'
import Sidebar from '@/components/sidebar'
import Header from '@/components/header'
import Walkthrough, { useWalkthroughAutoStart } from '@/components/walkthrough'
import HelpPanel from '@/components/help-panel'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  const [helpPanelOpen, setHelpPanelOpen] = useState(false)
  const shouldAutoStartWalkthrough = useWalkthroughAutoStart()

  // Auto-start walkthrough on first login
  useEffect(() => {
    if (shouldAutoStartWalkthrough) {
      setWalkthroughOpen(true)
    }
  }, [shouldAutoStartWalkthrough])

  const handleHelpClick = () => {
    setHelpPanelOpen(!helpPanelOpen)
  }

  const handleStartWalkthrough = () => {
    setWalkthroughOpen(true)
  }

  return (
    <div className="flex h-screen" style={{ background: '#fafbfc', fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}>
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onHelpClick={handleHelpClick}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
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
