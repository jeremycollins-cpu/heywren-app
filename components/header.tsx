'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Menu, LogOut, User } from 'lucide-react'
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

  return (
    <header className="h-16 border-b border-gray-200 bg-white flex items-center justify-between px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1" />

      {/* User Menu */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 transition"
        >
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900">
              {user?.user_metadata?.full_name || user?.email || 'User'}
            </p>
            <p className="text-xs text-gray-500">Account</p>
          </div>
          <div className="w-8 h-8 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
            {(user?.user_metadata?.full_name || user?.email || 'U')[0].toUpperCase()}
          </div>
        </button>

        {showDropdown && (
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
            <button
              onClick={() => {
                setShowDropdown(false)
                // Navigate to profile
              }}
              className="w-full text-left flex items-center gap-3 px-4 py-2 text-gray-700 hover:bg-gray-50 border-b border-gray-200"
            >
              <User className="w-4 h-4" />
              Profile
            </button>
            <button
              onClick={() => {
                setShowDropdown(false)
                handleLogout()
              }}
              className="w-full text-left flex items-center gap-3 px-4 py-2 text-red-600 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
