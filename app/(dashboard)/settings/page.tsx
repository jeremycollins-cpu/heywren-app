'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Settings as SettingsIcon, Bell, Lock, Users, Mail, MailWarning,
  Star, ShieldBan, Plus, X, ThumbsUp, ThumbsDown, AlertTriangle
} from 'lucide-react'
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
  // Missed email preferences
  const [emailPrefs, setEmailPrefs] = useState({
    vip_contacts: [] as Array<{ name?: string; email?: string; domain?: string }>,
    blocked_senders: [] as Array<{ email?: string; domain?: string }>,
    min_urgency: 'low' as string,
    scan_window_days: 7,
    enabled_categories: ['question', 'request', 'decision', 'follow_up', 'introduction'] as string[],
    auto_dismiss_days: 0,
    include_in_digest: true,
  })
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true)
  const [savingEmailPrefs, setSavingEmailPrefs] = useState(false)
  const [feedbackStats, setFeedbackStats] = useState({ validCount: 0, invalidCount: 0, total: 0 })
  const [suggestedBlocks, setSuggestedBlocks] = useState<Array<{ domain: string; count: number }>>([])
  const [newVipEmail, setNewVipEmail] = useState('')
  const [newVipName, setNewVipName] = useState('')
  const [newBlockedEntry, setNewBlockedEntry] = useState('')
  const [showAddVip, setShowAddVip] = useState(false)
  const [showAddBlocked, setShowAddBlocked] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    const fetchEmailPrefs = async () => {
      try {
        const [prefsRes, feedbackRes] = await Promise.all([
          fetch('/api/email-preferences'),
          fetch('/api/missed-email-feedback'),
        ])
        const prefsData = await prefsRes.json()
        const feedbackData = await feedbackRes.json()

        if (prefsData.preferences) {
          setEmailPrefs(prefsData.preferences)
        }
        if (feedbackData.stats) {
          setFeedbackStats(feedbackData.stats)
        }
        if (feedbackData.suggestedBlocks) {
          setSuggestedBlocks(feedbackData.suggestedBlocks)
        }
      } catch (err) {
        console.error('Error fetching email preferences:', err)
      }
      setEmailPrefsLoading(false)
    }
    fetchEmailPrefs()
  }, [])

  const saveEmailPrefs = async () => {
    setSavingEmailPrefs(true)
    try {
      const res = await fetch('/api/email-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailPrefs),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Email preferences saved')
      }
    } catch {
      toast.error('Failed to save email preferences')
    }
    setSavingEmailPrefs(false)
  }

  const addVipContact = () => {
    if (!newVipEmail.trim()) return
    const isVipDomain = newVipEmail.includes('@') === false && newVipEmail.includes('.') // e.g. "acme.com"
    const entry = isVipDomain
      ? { domain: newVipEmail.trim() }
      : { email: newVipEmail.trim(), name: newVipName.trim() || undefined }

    setEmailPrefs({
      ...emailPrefs,
      vip_contacts: [...emailPrefs.vip_contacts, entry],
    })
    setNewVipEmail('')
    setNewVipName('')
    setShowAddVip(false)
  }

  const removeVipContact = (index: number) => {
    setEmailPrefs({
      ...emailPrefs,
      vip_contacts: emailPrefs.vip_contacts.filter((_, i) => i !== index),
    })
  }

  const addBlockedSender = () => {
    if (!newBlockedEntry.trim()) return
    const isDomain = !newBlockedEntry.includes('@') && newBlockedEntry.includes('.')
    const entry = isDomain
      ? { domain: newBlockedEntry.trim() }
      : { email: newBlockedEntry.trim() }

    setEmailPrefs({
      ...emailPrefs,
      blocked_senders: [...emailPrefs.blocked_senders, entry],
    })
    setNewBlockedEntry('')
    setShowAddBlocked(false)
  }

  const removeBlockedSender = (index: number) => {
    setEmailPrefs({
      ...emailPrefs,
      blocked_senders: emailPrefs.blocked_senders.filter((_, i) => i !== index),
    })
  }

  const addSuggestedBlock = (domain: string) => {
    if (emailPrefs.blocked_senders.some(b => b.domain === domain)) return
    setEmailPrefs({
      ...emailPrefs,
      blocked_senders: [...emailPrefs.blocked_senders, { domain }],
    })
    setSuggestedBlocks(suggestedBlocks.filter(s => s.domain !== domain))
  }

  const toggleCategory = (cat: string) => {
    const current = emailPrefs.enabled_categories
    const updated = current.includes(cat)
      ? current.filter(c => c !== cat)
      : [...current, cat]
    setEmailPrefs({ ...emailPrefs, enabled_categories: updated })
  }

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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Manage your profile, notifications, and privacy preferences
        </p>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6 animate-pulse" role="status" aria-live="polite" aria-busy="true" aria-label="Loading settings">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-5 h-5 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
          <div className="space-y-6">
            <div>
              <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
            <div>
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
            <div>
              <div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded mb-2" />
              <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded-lg" />
            </div>
            <div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading settings</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Profile Settings */}
      {!loading && !error && (
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <SettingsIcon aria-hidden="true" className="w-5 h-5" />
          Profile
        </h2>

        <div className="space-y-6">
          <div>
            <label htmlFor="settings-fullname" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Full Name</label>
            <input
              id="settings-fullname"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
            />
          </div>

          <div>
            <label htmlFor="settings-email" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Email</label>
            <input
              id="settings-email"
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-gray-50 dark:bg-surface-dark text-gray-600 dark:text-gray-400 focus:outline-none"
              aria-describedby="email-help"
            />
            <p id="email-help" className="text-xs text-gray-500 dark:text-gray-400 mt-1">Contact support to change email</p>
          </div>

          <div>
            <label htmlFor="settings-role" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Role</label>
            <select
              id="settings-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-surface-dark dark:text-white"
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
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <Bell aria-hidden="true" className="w-5 h-5" />
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
            <div key={setting.id} className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{setting.label}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{setting.description}</p>
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
                aria-label={setting.label}
                className="w-5 h-5 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Privacy Settings */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <Lock aria-hidden="true" className="w-5 h-5" />
          Privacy & Security
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Two-Factor Authentication</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Add extra security to your account</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Enable
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Change Password</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Update your password</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Change
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Data & Privacy</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Download your data or delete account</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Team Settings */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <Users aria-hidden="true" className="w-5 h-5" />
          Team
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="settings-teamname" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Team Name</label>
            <input
              id="settings-teamname"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Team Members</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Team management coming soon. Invite users through Slack or email integrations.</p>
            <div className="space-y-3">
              {user && (
                <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{user?.user_metadata?.full_name || 'You'}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{user?.email}</p>
                  </div>
                  <span className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded-lg font-medium">Owner</span>
                </div>
              )}
            </div>
          </div>

          <button className="w-full px-4 py-2 border border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-500 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition">
            + Invite Team Member
          </button>
        </div>
      </div>

      {/* Missed Emails Settings */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <MailWarning aria-hidden="true" className="w-5 h-5" />
          Missed Emails
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Control how HeyWren detects emails awaiting your response. Your feedback trains the AI to get smarter over time.
        </p>

        {emailPrefsLoading ? (
          <div className="animate-pulse space-y-4" role="status" aria-busy="true" aria-label="Loading email preferences">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg"></div>)}
          </div>
        ) : (
          <div className="space-y-8">
            {/* VIP Contacts */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star aria-hidden="true" className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">VIP Contacts — Never Miss</h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Emails from these people or domains will always be surfaced, regardless of AI classification. Add your boss, key clients, or board members.
              </p>

              {emailPrefs.vip_contacts.length > 0 && (
                <div className="space-y-2 mb-3">
                  {emailPrefs.vip_contacts.map((contact, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Star aria-hidden="true" className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-sm text-gray-900 dark:text-white">
                          {contact.domain ? (
                            <span className="font-medium">@{contact.domain}</span>
                          ) : (
                            <>
                              {contact.name && <span className="font-medium">{contact.name} — </span>}
                              <span className="text-gray-600 dark:text-gray-400">{contact.email}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <button
                        onClick={() => removeVipContact(i)}
                        className="text-gray-400 hover:text-red-500 transition"
                        aria-label={`Remove ${contact.email || contact.domain}`}
                      >
                        <X aria-hidden="true" className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAddVip ? (
                <div className="space-y-2 p-3 border border-gray-200 dark:border-border-dark rounded-lg">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newVipEmail}
                      onChange={(e) => setNewVipEmail(e.target.value)}
                      placeholder="Email or domain (e.g. jane@acme.com or acme.com)"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                    />
                  </div>
                  <input
                    type="text"
                    value={newVipName}
                    onChange={(e) => setNewVipName(e.target.value)}
                    placeholder="Name (optional)"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button onClick={addVipContact} className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition">Add VIP</button>
                    <button onClick={() => setShowAddVip(false)} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddVip(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                >
                  <Plus aria-hidden="true" className="w-4 h-4" />
                  Add VIP contact or domain
                </button>
              )}
            </div>

            {/* Blocked Senders */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShieldBan aria-hidden="true" className="w-4 h-4 text-red-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Blocked Senders — Always Ignore</h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Emails from these addresses or domains will never be flagged. Use this for internal tools, mailing lists, or persistent false positives.
              </p>

              {emailPrefs.blocked_senders.length > 0 && (
                <div className="space-y-2 mb-3">
                  {emailPrefs.blocked_senders.map((sender, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <ShieldBan aria-hidden="true" className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-sm text-gray-900 dark:text-white">
                          {sender.domain ? <span className="font-medium">@{sender.domain}</span> : sender.email}
                        </span>
                      </div>
                      <button
                        onClick={() => removeBlockedSender(i)}
                        className="text-gray-400 hover:text-red-500 transition"
                        aria-label={`Unblock ${sender.email || sender.domain}`}
                      >
                        <X aria-hidden="true" className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggested blocks from feedback */}
              {suggestedBlocks.length > 0 && (
                <div className="mb-3 p-3 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-1">
                    <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
                    Suggested blocks based on your feedback:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {suggestedBlocks.map(({ domain, count }) => (
                      <button
                        key={domain}
                        onClick={() => addSuggestedBlock(domain)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-full hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                      >
                        <Plus aria-hidden="true" className="w-3 h-3" />
                        @{domain}
                        <span className="text-gray-400">({count}x marked invalid)</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {showAddBlocked ? (
                <div className="space-y-2 p-3 border border-gray-200 dark:border-border-dark rounded-lg">
                  <input
                    type="text"
                    value={newBlockedEntry}
                    onChange={(e) => setNewBlockedEntry(e.target.value)}
                    placeholder="Email or domain (e.g. spam@vendor.com or vendor.com)"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                  />
                  <div className="flex gap-2">
                    <button onClick={addBlockedSender} className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition">Block</button>
                    <button onClick={() => setShowAddBlocked(false)} className="px-3 py-1.5 text-sm border border-gray-200 dark:border-border-dark text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddBlocked(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                >
                  <Plus aria-hidden="true" className="w-4 h-4" />
                  Block a sender or domain
                </button>
              )}
            </div>

            {/* Scan Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Min Urgency */}
              <div>
                <label htmlFor="min-urgency" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Minimum Urgency to Show</label>
                <select
                  id="min-urgency"
                  value={emailPrefs.min_urgency}
                  onChange={(e) => setEmailPrefs({ ...emailPrefs, min_urgency: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-surface-dark dark:text-white"
                >
                  <option value="low">All (Low and above)</option>
                  <option value="medium">Medium and above</option>
                  <option value="high">High and above</option>
                  <option value="critical">Critical only</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Emails below this threshold won't appear on your dashboard</p>
              </div>

              {/* Scan Window */}
              <div>
                <label htmlFor="scan-window" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Scan Window</label>
                <select
                  id="scan-window"
                  value={emailPrefs.scan_window_days}
                  onChange={(e) => setEmailPrefs({ ...emailPrefs, scan_window_days: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-surface-dark dark:text-white"
                >
                  <option value={3}>Last 3 days</option>
                  <option value={7}>Last 7 days</option>
                  <option value={14}>Last 14 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">How far back to look for missed emails</p>
              </div>

              {/* Auto Dismiss */}
              <div>
                <label htmlFor="auto-dismiss" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Auto-Dismiss After</label>
                <select
                  id="auto-dismiss"
                  value={emailPrefs.auto_dismiss_days}
                  onChange={(e) => setEmailPrefs({ ...emailPrefs, auto_dismiss_days: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-surface-dark dark:text-white"
                >
                  <option value={0}>Never auto-dismiss</option>
                  <option value={7}>After 7 days</option>
                  <option value={14}>After 14 days</option>
                  <option value={30}>After 30 days</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Automatically dismiss stale missed emails</p>
              </div>

              {/* Digest toggle */}
              <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg self-start">
                <div>
                  <p className="font-medium text-sm text-gray-900 dark:text-white">Include in Daily Digest</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Add missed emails to your morning digest email</p>
                </div>
                <input
                  type="checkbox"
                  checked={emailPrefs.include_in_digest}
                  onChange={(e) => setEmailPrefs({ ...emailPrefs, include_in_digest: e.target.checked })}
                  aria-label="Include missed emails in daily digest"
                  className="w-5 h-5 cursor-pointer"
                />
              </div>
            </div>

            {/* Category Toggles */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Categories to Surface</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Choose which types of emails to flag. Disable categories you don't care about.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'question', label: 'Questions', desc: 'Direct questions to you' },
                  { id: 'request', label: 'Requests', desc: 'Asks for deliverables or action' },
                  { id: 'decision', label: 'Decisions', desc: 'Need your sign-off or choice' },
                  { id: 'follow_up', label: 'Follow-ups', desc: 'Someone circling back' },
                  { id: 'introduction', label: 'Introductions', desc: 'New people reaching out' },
                ].map((cat) => {
                  const enabled = emailPrefs.enabled_categories.includes(cat.id)
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleCategory(cat.id)}
                      className={`p-3 rounded-lg border text-left transition ${
                        enabled
                          ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                          : 'border-gray-200 dark:border-border-dark bg-gray-50 dark:bg-surface-dark opacity-60'
                      }`}
                    >
                      <p className={`text-sm font-medium ${enabled ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}`}>{cat.label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cat.desc}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Feedback Stats */}
            {feedbackStats.total > 0 && (
              <div className="p-4 bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-border-dark rounded-lg">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Your Feedback — Training the AI</h3>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <ThumbsUp aria-hidden="true" className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{feedbackStats.validCount} valid</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ThumbsDown aria-hidden="true" className="w-4 h-4 text-red-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{feedbackStats.invalidCount} invalid</span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {feedbackStats.total} total ratings — more feedback = smarter filtering
                  </span>
                </div>
              </div>
            )}

            {/* Save Button */}
            <button
              onClick={saveEmailPrefs}
              disabled={savingEmailPrefs}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingEmailPrefs ? 'Saving...' : 'Save Email Preferences'}
            </button>
          </div>
        )}
      </div>

      {/* Connected Integrations */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
          <Mail aria-hidden="true" className="w-5 h-5" />
          Connected Integrations
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Manage your integrations from the Integrations page.</p>
        <a href="/integrations" className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
          Go to Integrations
        </a>
      </div>
    </div>
  )
}
