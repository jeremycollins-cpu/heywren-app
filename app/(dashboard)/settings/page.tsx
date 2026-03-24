'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Settings as SettingsIcon, Bell, Lock, Users, Mail } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [teamName, setTeamName] = useState('')
  const [saving, setSaving] = useState(false)
  const [notifications, setNotifications] = useState({
    slack: true,
    email: true,
    overdue: true,
    weekly: true,
  })
  const supabase = createClient()

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) throw userError
        if (!user) throw new Error('No user found')

        setUser(user)
        setFullName(user.user_metadata?.full_name || '')

        // Fetch profile to get role and current_team_id
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, current_team_id')
          .eq('id', user.id)
          .single()

        if (profileError) {
          console.error('Error fetching profile:', profileError)
        } else {
          setRole(profile.role || '')

          // Fetch team name
          if (profile.current_team_id) {
            const { data: team, error: teamError } = await supabase
              .from('teams')
              .select('name')
              .eq('id', profile.current_team_id)
              .single()

            if (teamError) {
              console.error('Error fetching team:', teamError)
            } else {
              setTeamName(team.name || '')
            }
          }
        }
      } catch (err) {
        console.error('Error fetching user:', err)
        setError(err instanceof Error ? err.message : 'Failed to load user data')
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [supabase])

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName, role },
      })
      if (error) throw error
      toast.success('Settings saved successfully')
    } catch (err) {
      console.error('Error saving settings:', err)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">
          Manage your profile, notifications, and privacy preferences
        </p>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-5 h-5 bg-gray-200 rounded" />
            <div className="h-5 w-20 bg-gray-200 rounded" />
          </div>
          <div className="space-y-6">
            <div>
              <div className="h-4 w-24 bg-gray-200 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 rounded-lg" />
            </div>
            <div>
              <div className="h-4 w-16 bg-gray-200 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 rounded-lg" />
            </div>
            <div>
              <div className="h-4 w-12 bg-gray-200 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 rounded-lg" />
            </div>
            <div className="h-10 w-32 bg-gray-200 rounded-lg" />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading settings</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Profile Settings */}
      {!loading && !error && (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <SettingsIcon className="w-5 h-5" />
          Profile
        </h2>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Email</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600 focus:outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Contact support to change email</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            >
              <option value="">Select a role</option>
              <option value="CEO">CEO</option>
              <option value="VP Sales">VP Sales</option>
              <option value="VP Product">VP Product</option>
              <option value="VP Engineering">VP Engineering</option>
              <option value="Manager">Manager</option>
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
      )}

      {/* Notification Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Bell className="w-5 h-5" />
          Notifications
        </h2>

        <div className="space-y-4">
          {[
            {
              id: 'slack',
              label: 'Slack Notifications',
              description: 'Get real-time alerts in Slack',
            },
            {
              id: 'email',
              label: 'Email Digests',
              description: 'Daily and weekly email summaries',
            },
            {
              id: 'overdue',
              label: 'Overdue Alerts',
              description: 'Be notified of overdue commitments',
            },
            {
              id: 'weekly',
              label: 'Weekly Review',
              description: 'Sunday summary of the week',
            },
          ].map((setting) => (
            <div key={setting.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{setting.label}</p>
                <p className="text-sm text-gray-600">{setting.description}</p>
              </div>
              <input
                type="checkbox"
                checked={notifications[setting.id as keyof typeof notifications]}
                onChange={(e) =>
                  setNotifications({
                    ...notifications,
                    [setting.id]: e.target.checked,
                  })
                }
                className="w-5 h-5 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Lock className="w-5 h-5" />
          Privacy & Security
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Two-Factor Authentication</p>
              <p className="text-sm text-gray-600">Add extra security to your account</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
              Enable
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Change Password</p>
              <p className="text-sm text-gray-600">Update your password</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
              Change
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Data & Privacy</p>
              <p className="text-sm text-gray-600">Download your data or delete account</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Team Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Team
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Team Name</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4">Team Members</h3>
            <p className="text-sm text-gray-600 mb-4">Team management coming soon. Invite users through Slack or email integrations.</p>
            <div className="space-y-3">
              {user && (
                <div className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{user?.user_metadata?.full_name || 'You'}</p>
                    <p className="text-sm text-gray-600">{user?.email}</p>
                  </div>
                  <span className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded-lg font-medium">Owner</span>
                </div>
              )}
            </div>
          </div>

          <button className="w-full px-4 py-2 border border-indigo-600 text-indigo-600 rounded-lg hover:bg-indigo-50 transition">
            + Invite Team Member
          </button>
        </div>
      </div>

      {/* Connected Integrations */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Connected Integrations
        </h2>

        <p className="text-sm text-gray-600 mb-4">Manage your integrations from the Integrations page.</p>
        <a href="/integrations" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
          Go to Integrations
        </a>
      </div>
    </div>
  )
}
