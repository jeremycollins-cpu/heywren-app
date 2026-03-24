'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Users, Mail, Trash2, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import UpgradeGate from '@/components/upgrade-gate'

interface TeamMember {
  id: string
  user_id: string
  role: string
  profiles: {
    email: string
    full_name: string
    avatar_url?: string
  }
}

export default function TeamManagementPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchTeamData = async () => {
      try {
        const { data: user } = await supabase.auth.getUser()
        if (!user?.user) return

        // Get user role
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, current_team_id')
          .eq('id', user.user.id)
          .single()

        setCurrentUserRole(profile?.role || 'user')

        if (!profile?.current_team_id) {
          setLoading(false)
          return
        }

        // Get team members
        const { data: teamMembers } = await supabase
          .from('team_members')
          .select(
            `
            id,
            user_id,
            role,
            profiles (
              email,
              full_name,
              avatar_url
            )
          `
          )
          .eq('team_id', profile.current_team_id)

        const normalized = (teamMembers || []).map((m: any) => ({
          ...m,
          profiles: Array.isArray(m.profiles) ? m.profiles[0] : m.profiles,
        }))
        setMembers(normalized)
      } catch (err) {
        console.error('Error fetching team data:', err)
        toast.error('Failed to load team members')
      } finally {
        setLoading(false)
      }
    }

    fetchTeamData()
  }, [supabase])

  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'super_admin'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500 dark:text-gray-400">Loading team members...</p>
      </div>
    )
  }

  return (
    <UpgradeGate featureKey="team_management">
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Team Management</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">Manage your team members and their roles</p>
      </div>

      {/* Team Members */}
      <div className="card dark:bg-surface-dark-secondary dark:border-border-dark">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Team Members</h2>
          {isAdmin && (
            <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all">
              Add Member
            </button>
          )}
        </div>

        {members.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No team members yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-gray-200 dark:border-border-dark">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Email</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Role</th>
                  {isAdmin && (
                    <th className="px-6 py-3 text-right text-sm font-medium text-gray-700 dark:text-gray-300">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-border-dark">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                            {member.profiles?.full_name
                              ? member.profiles.full_name.charAt(0).toUpperCase()
                              : '?'}
                          </span>
                        </div>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {member.profiles?.full_name || 'Unknown'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{member.profiles?.email || '-'}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
                        {member.role === 'owner' ? (
                          <>
                            <Crown className="w-4 h-4" />
                            {member.role}
                          </>
                        ) : (
                          member.role
                        )}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-right">
                        <button className="text-red-600 hover:text-red-700 transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Invitations */}
      <div className="card dark:bg-surface-dark-secondary dark:border-border-dark">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Pending Invitations</h2>
        <div className="text-center py-12">
          <Mail className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">No pending invitations</p>
        </div>
      </div>
    </div>
    </UpgradeGate>
  )
}
