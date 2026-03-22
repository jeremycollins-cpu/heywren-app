'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Menu, LogOut, User, Settings, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)
    }

    fetchUser()
  }, [supabase])

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
    <header
      className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6"
      style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif' }}
    >
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
      >
        <Menu className="w-5 h-5 text-gray-600" />
      </button>

      <div className="flex-1" />

      {/* User Menu */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition"
        >
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-gray-900" style={{ letterSpacing: '-0.01em' }}>
              {user?.user_metadata?.full_name || user?.email || 'User'}
            </p>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
          >
            {initials}
          </div>
        </button>

        {showDropdown && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div className="absolute right-0 mt-1.5 w-52 bg-white rounded-lg border border-gray-200 z-50 py-1" style={{ boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)' }}>
              <div className="px-4 py-2.5 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">{user?.user_metadata?.full_name || 'User'}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <Link
                href="/settings"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                <Settings className="w-4 h-4 text-gray-400" />
                Settings
              </Link>
              <Link
                href="/billing"
                onClick={() => setShowDropdown(false)}
                className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                <CreditCard className="w-4 h-4 text-gray-400" />
                Billing
              </Link>
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => {
                    setShowDropdown(false)
                    handleLogout()
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
