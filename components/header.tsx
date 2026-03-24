'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Menu, LogOut, Settings, CreditCard, Moon, Sun } from 'lucide-react'
import toast from 'react-hot-toast'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    fetchUser()
  }, [supabase])

  // Initialize dark mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('heywren_dark_mode')
    if (saved === 'true') {
      setDarkMode(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('heywren_dark_mode', 'true')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('heywren_dark_mode', 'false')
    }
  }

  // Close dropdown on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setShowDropdown(false)
  }, [])

  useEffect(() => {
    if (showDropdown) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showDropdown, handleKeyDown])

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut()
    if (!error) {
      toast.success('Logged out successfully')
      router.push('/login')
    } else {
      toast.error('Failed to logout')
    }
  }

  const initials = (user?.user_metadata?.full_name || user?.email || 'U')
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)

  return (
    <header className="h-14 border-b border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark-secondary flex items-center justify-between px-6 transition-colors duration-300">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
        aria-label="Toggle menu"
      >
        <Menu className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </button>

      <div className="flex-1" />

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-all duration-200"
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
        </button>

        {/* User Menu */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-all duration-200"
            aria-expanded={showDropdown}
            aria-haspopup="true"
          >
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900 dark:text-white" style={{ letterSpacing: '-0.01em' }}>
                {user?.user_metadata?.full_name || user?.email || 'User'}
              </p>
            </div>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shadow-brand-sm"
              style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
            >
              {initials}
            </div>
          </button>

          {showDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
              <div
                className="absolute right-0 mt-1.5 w-52 bg-white dark:bg-surface-dark-secondary rounded-brand border border-gray-200 dark:border-border-dark z-50 py-1 animate-scale-in"
                style={{ boxShadow: 'var(--shadow-md)' }}
                role="menu"
              >
                <div className="px-4 py-2.5 border-b border-gray-100 dark:border-border-dark">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{user?.user_metadata?.full_name || 'User'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setShowDropdown(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  role="menuitem"
                >
                  <Settings className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  Settings
                </Link>
                <Link
                  href="/billing"
                  onClick={() => setShowDropdown(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  role="menuitem"
                >
                  <CreditCard className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  Billing
                </Link>
                <div className="border-t border-gray-100 dark:border-border-dark mt-1 pt-1">
                  <button
                    onClick={() => {
                      setShowDropdown(false)
                      handleLogout()
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    role="menuitem"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
