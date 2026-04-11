'use client'

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

// Randomised flight path picked each time the celebration fires
export interface CelebrationVariant {
  topPercent: number   // vertical position of the bird (% from top)
  direction: 'ltr' | 'rtl'  // left-to-right or right-to-left
}

interface CelebrationContextValue {
  celebrating: boolean
  variant: CelebrationVariant | null
  celebrate: () => void
}

const CelebrationContext = createContext<CelebrationContextValue | undefined>(undefined)

const CELEBRATION_DURATION = 3500 // ms — matches the fly-across animation
const COOLDOWN = 5000 // ms — prevent rapid re-triggers
const TRIGGER_CHANCE = 1.0 // TEMPORARY: 100% for testing — revert to 0.3 after verification

function pickVariant(): CelebrationVariant {
  return {
    topPercent: 18 + Math.random() * 30, // fly between 18% and 48% from top
    direction: Math.random() > 0.5 ? 'ltr' : 'rtl',
  }
}

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [celebrating, setCelebrating] = useState(false)
  const [variant, setVariant] = useState<CelebrationVariant | null>(null)
  const lastCelebration = useRef(0)

  const celebrate = useCallback(() => {
    const now = Date.now()
    if (now - lastCelebration.current < COOLDOWN) return
    if (Math.random() > TRIGGER_CHANCE) return // skip most completions

    lastCelebration.current = now
    setVariant(pickVariant())
    setCelebrating(true)
    setTimeout(() => {
      setCelebrating(false)
      setVariant(null)
    }, CELEBRATION_DURATION)
  }, [])

  return (
    <CelebrationContext.Provider value={{ celebrating, variant, celebrate }}>
      {children}
    </CelebrationContext.Provider>
  )
}

export function useCelebration() {
  const ctx = useContext(CelebrationContext)
  if (!ctx) throw new Error('useCelebration must be used within CelebrationProvider')
  return ctx
}
