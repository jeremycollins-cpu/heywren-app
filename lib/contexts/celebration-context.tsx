'use client'

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

interface CelebrationContextValue {
  celebrating: boolean
  celebrate: () => void
}

const CelebrationContext = createContext<CelebrationContextValue | undefined>(undefined)

const CELEBRATION_DURATION = 3500 // ms — matches the fly-across animation
const COOLDOWN = 5000 // ms — prevent rapid re-triggers

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [celebrating, setCelebrating] = useState(false)
  const lastCelebration = useRef(0)

  const celebrate = useCallback(() => {
    const now = Date.now()
    if (now - lastCelebration.current < COOLDOWN) return
    lastCelebration.current = now
    setCelebrating(true)
    setTimeout(() => setCelebrating(false), CELEBRATION_DURATION)
  }, [])

  return (
    <CelebrationContext.Provider value={{ celebrating, celebrate }}>
      {children}
    </CelebrationContext.Provider>
  )
}

export function useCelebration() {
  const ctx = useContext(CelebrationContext)
  if (!ctx) throw new Error('useCelebration must be used within CelebrationProvider')
  return ctx
}
