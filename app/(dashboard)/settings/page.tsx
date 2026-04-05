'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Settings as SettingsIcon, Bell, Lock, Users, Mail, MailWarning,
  Star, ShieldBan, Plus, X, ThumbsUp, ThumbsDown, AlertTriangle,
  Trophy, Folder, RefreshCw, Check, Clock, Palmtree, Plane, Stethoscope,
  CalendarDays, Trash2
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
  const [savingNotifications, setSavingNotifications] = useState(false)
  const [notifications, setNotifications] = useState({
    slack: true,
    email: true,
    overdue: true,
    weekly: true,
  })
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  // Missed email preferences
  const [emailPrefs, setEmailPrefs] = useState({
    vip_contacts: [] as Array<{ name?: string; email?: string; domain?: string }>,
    blocked_senders: [] as Array<{ email?: string; domain?: string }>,
    min_urgency: 'low' as string,
    scan_window_days: 7,
    enabled_categories: ['question', 'request', 'decision', 'follow_up', 'introduction'] as string[],
    auto_dismiss_days: 0,
    include_in_digest: true,
    priority_folders: [] as string[],
    excluded_folders: [] as string[],
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
  const [newPriorityFolder, setNewPriorityFolder] = useState('')
  const [newExcludedFolder, setNewExcludedFolder] = useState('')
  const [outlookFolders, setOutlookFolders] = useState<Array<{ id: string; name: string; totalCount: number; unreadCount: number }>>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  const [foldersLoaded, setFoldersLoaded] = useState(false)
  // Gamification notification preferences
  const [gamificationPrefs, setGamificationPrefs] = useState({
    achievement_notifications: true,
    streak_notifications: true,
    leaderboard_notifications: true,
    challenge_notifications: true,
    weekly_digest: true,
    celebration_posts: true,
  })
  const [gamificationPrefsLoading, setGamificationPrefsLoading] = useState(true)
  // Work schedule
  const [workSchedule, setWorkSchedule] = useState({
    work_days: [1, 2, 3, 4, 5] as number[],
    start_time: '08:00',
    end_time: '17:00',
    timezone: null as string | null,
    idle_threshold_minutes: 60,
    after_hours_alert: true,
  })
  const [orgTimezone, setOrgTimezone] = useState('America/New_York')
  const [workScheduleLoading, setWorkScheduleLoading] = useState(true)
  const [savingWorkSchedule, setSavingWorkSchedule] = useState(false)
  // OOO (Out of Office)
  interface OooPeriod {
    id: string
    startDate: string
    endDate: string
    oooType: 'pto' | 'travel' | 'sick' | 'other'
    note: string | null
    status: 'active' | 'completed' | 'cancelled'
  }
  const [oooPeriods, setOooPeriods] = useState<OooPeriod[]>([])
  const [oooLoading, setOooLoading] = useState(true)
  const [savingOoo, setSavingOoo] = useState(false)
  const [showAddOoo, setShowAddOoo] = useState(false)
  const [newOoo, setNewOoo] = useState({
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    ooo_type: 'pto' as 'pto' | 'travel' | 'sick' | 'other',
    note: '',
  })

  // Company holidays
  interface CompanyHoliday {
    id: string
    name: string
    date: string
    recurring: boolean
  }
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHoliday[]>([])
  const [holidaysLoading, setHolidaysLoading] = useState(true)
  const [showAddHoliday, setShowAddHoliday] = useState(false)
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '', recurring: false })
  const [savingHoliday, setSavingHoliday] = useState(false)

  // Company domains
  const [companyDomains, setCompanyDomains] = useState<string[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [savingDomains, setSavingDomains] = useState(false)
  const [isOrgAdmin, setIsOrgAdmin] = useState(false)

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

    const fetchGamificationPrefs = async () => {
      try {
        const res = await fetch('/api/notification-preferences')
        const data = await res.json()
        if (data.preferences) {
          setGamificationPrefs(data.preferences)
        }
      } catch (err) {
        console.error('Error fetching gamification notification preferences:', err)
      }
      setGamificationPrefsLoading(false)
    }
    fetchGamificationPrefs()

    const fetchDomains = async () => {
      try {
        const res = await fetch('/api/organization-domains')
        const data = await res.json()
        if (data.domains) setCompanyDomains(data.domains)
        if (data.isAdmin) setIsOrgAdmin(true)
      } catch (err) {
        console.error('Error fetching company domains:', err)
      }
      setDomainsLoading(false)
    }
    fetchDomains()

    const fetchWorkSchedule = async () => {
      try {
        const res = await fetch('/api/work-schedule')
        const data = await res.json()
        if (data.schedule) setWorkSchedule(data.schedule)
        if (data.orgTimezone) setOrgTimezone(data.orgTimezone)
      } catch (err) {
        console.error('Error fetching work schedule:', err)
      }
      setWorkScheduleLoading(false)
    }
    fetchWorkSchedule()

    const fetchOooPeriods = async () => {
      try {
        const res = await fetch('/api/ooo')
        const data = await res.json()
        if (data.periods) {
          // Filter to active/upcoming only (not cancelled)
          const activePeriods = data.periods.filter(
            (p: OooPeriod) => p.status === 'active'
          )
          setOooPeriods(activePeriods)
        }
      } catch (err) {
        console.error('Error fetching OOO periods:', err)
      }
      setOooLoading(false)
    }
    fetchOooPeriods()

    const fetchCompanyHolidays = async () => {
      try {
        const res = await fetch('/api/company-holidays')
        const data = await res.json()
        if (data.holidays) setCompanyHolidays(data.holidays)
        if (data.isAdmin) setIsOrgAdmin(true)
      } catch (err) {
        console.error('Error fetching company holidays:', err)
      }
      setHolidaysLoading(false)
    }
    fetchCompanyHolidays()
  }, [])

  const addCompanyHoliday = async () => {
    if (!newHoliday.name.trim() || !newHoliday.date) {
      toast.error('Please enter a name and date')
      return
    }
    setSavingHoliday(true)
    try {
      const res = await fetch('/api/company-holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHoliday),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Holiday added')
        setCompanyHolidays(prev => [...prev, data.holiday].sort(
          (a: CompanyHoliday, b: CompanyHoliday) => a.date.localeCompare(b.date)
        ))
        setShowAddHoliday(false)
        setNewHoliday({ name: '', date: '', recurring: false })
      }
    } catch {
      toast.error('Failed to add holiday')
    }
    setSavingHoliday(false)
  }

  const removeCompanyHoliday = async (id: string) => {
    try {
      const res = await fetch(`/api/company-holidays?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Holiday removed')
        setCompanyHolidays(prev => prev.filter(h => h.id !== id))
      }
    } catch {
      toast.error('Failed to remove holiday')
    }
  }

  const createOooPeriod = async () => {
    if (!newOoo.start_date || !newOoo.end_date) {
      toast.error('Please select start and end dates')
      return
    }
    if (newOoo.end_date < newOoo.start_date) {
      toast.error('End date must be after start date')
      return
    }
    setSavingOoo(true)
    try {
      const res = await fetch('/api/ooo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: newOoo.start_date,
          endDate: newOoo.end_date,
          oooType: newOoo.ooo_type,
          note: newOoo.note || undefined,
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Out of office period created')
        const p = data.period
        setOooPeriods(prev => [{
          id: p.id,
          startDate: p.start_date,
          endDate: p.end_date,
          oooType: p.ooo_type,
          note: p.note,
          status: p.status,
        }, ...prev])
        setShowAddOoo(false)
        setNewOoo({
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          ooo_type: 'pto',
          note: '',
        })
      }
    } catch {
      toast.error('Failed to create OOO period')
    }
    setSavingOoo(false)
  }

  const cancelOooPeriod = async (id: string) => {
    try {
      const res = await fetch('/api/ooo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'cancelled' }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('OOO period cancelled')
        setOooPeriods(prev => prev.filter(p => p.id !== id))
      }
    } catch {
      toast.error('Failed to cancel OOO period')
    }
  }

  const loadOutlookFolders = async () => {
    setFoldersLoading(true)
    try {
      const res = await fetch('/api/outlook-folders')
      const data = await res.json()
      if (data.folders) {
        setOutlookFolders(data.folders)
        setFoldersLoaded(true)
      }
    } catch {
      toast.error('Failed to load email folders')
    }
    setFoldersLoading(false)
  }

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

  const addCompanyDomain = () => {
    const domain = newDomain.trim().toLowerCase().replace(/^@/, '')
    if (!domain || !domain.includes('.')) {
      toast.error('Enter a valid domain (e.g. acme.com)')
      return
    }
    if (companyDomains.includes(domain)) {
      toast.error('Domain already added')
      return
    }
    setCompanyDomains([...companyDomains, domain])
    setNewDomain('')
  }

  const removeCompanyDomain = (index: number) => {
    setCompanyDomains(companyDomains.filter((_, i) => i !== index))
  }

  const saveCompanyDomains = async () => {
    setSavingDomains(true)
    try {
      const res = await fetch('/api/organization-domains', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: companyDomains }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Company domains saved')
      }
    } catch {
      toast.error('Failed to save company domains')
    }
    setSavingDomains(false)
  }

  const toggleGamificationPref = async (key: keyof typeof gamificationPrefs) => {
    const updated = { ...gamificationPrefs, [key]: !gamificationPrefs[key] }
    setGamificationPrefs(updated) // optimistic update
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      const data = await res.json()
      if (data.error) {
        // revert on error
        setGamificationPrefs(gamificationPrefs)
        toast.error(data.error)
      }
    } catch {
      setGamificationPrefs(gamificationPrefs) // revert
      toast.error('Failed to update notification preference')
    }
  }

  const saveWorkSchedule = async () => {
    setSavingWorkSchedule(true)
    try {
      const res = await fetch('/api/work-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workSchedule),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
      } else {
        toast.success('Work schedule saved')
      }
    } catch {
      toast.error('Failed to save work schedule')
    }
    setSavingWorkSchedule(false)
  }

  const toggleWorkDay = (day: number) => {
    const current = workSchedule.work_days
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort()
    setWorkSchedule({ ...workSchedule, work_days: updated })
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
        if (user.user_metadata?.notifications) {
          setNotifications({
            slack: user.user_metadata.notifications.slack ?? true,
            email: user.user_metadata.notifications.email ?? true,
            overdue: user.user_metadata.notifications.overdue ?? true,
            weekly: user.user_metadata.notifications.weekly ?? true,
          })
        }

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
      // Save profile metadata (auth + profiles table)
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName, role },
      })
      if (error) throw error

      // Also update role in profiles table so it's readable by other queries
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ display_name: fullName, role })
        .eq('id', user.id)
      if (profileError) console.error('Error updating profile:', profileError)

      // Save team name if user has a team
      const { data: profile } = await supabase
        .from('profiles')
        .select('current_team_id')
        .eq('id', user.id)
        .single()

      if (profile?.current_team_id && teamName.trim()) {
        const { error: teamError } = await supabase
          .from('teams')
          .update({ name: teamName.trim() })
          .eq('id', profile.current_team_id)
        if (teamError) throw teamError
      }

      toast.success('Settings saved successfully')
    } catch (err) {
      console.error('Error saving settings:', err)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNotifications = async () => {
    setSavingNotifications(true)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { notifications },
      })
      if (error) throw error
      toast.success('Notification preferences saved')
    } catch (err) {
      console.error('Error saving notifications:', err)
      toast.error('Failed to save notification preferences')
    } finally {
      setSavingNotifications(false)
    }
  }

  const handleChangePassword = async () => {
    if (!newPassword.trim()) {
      toast.error('Password cannot be empty')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSavingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      toast.success('Password changed successfully')
      setShowPasswordModal(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      console.error('Error changing password:', err)
      toast.error('Failed to change password')
    } finally {
      setSavingPassword(false)
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

        <button
          onClick={handleSaveNotifications}
          disabled={savingNotifications}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {savingNotifications ? 'Saving...' : 'Save Notifications'}
        </button>
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
            <button
              onClick={() => toast('Two-factor authentication is not yet available. Coming soon!', { icon: 'ℹ️' })}
              className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Enable
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Change Password</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Update your password</p>
            </div>
            <button
              onClick={() => setShowPasswordModal(true)}
              className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Change
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Data & Privacy</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Download your data or delete account</p>
            </div>
            <button
              onClick={() => toast('Data & Privacy management is not yet available. Coming soon!', { icon: 'ℹ️' })}
              className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Manage
            </button>
          </div>
        </div>
      </div>

      {/* Work Schedule */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
          <Clock aria-hidden="true" className="w-5 h-5" />
          Work Schedule
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Set your working hours for activity monitoring. Your manager sees anomalies based on this schedule.
        </p>

        {workScheduleLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Work Days */}
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Work Days</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { day: 0, label: 'Sun' },
                  { day: 1, label: 'Mon' },
                  { day: 2, label: 'Tue' },
                  { day: 3, label: 'Wed' },
                  { day: 4, label: 'Thu' },
                  { day: 5, label: 'Fri' },
                  { day: 6, label: 'Sat' },
                ].map(({ day, label }) => {
                  const isActive = workSchedule.work_days.includes(day)
                  return (
                    <button
                      key={day}
                      onClick={() => toggleWorkDay(day)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        isActive
                          ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Work Hours */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="settings-start-time" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">Start Time</label>
                <input
                  id="settings-start-time"
                  type="time"
                  value={workSchedule.start_time}
                  onChange={e => setWorkSchedule({ ...workSchedule, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="settings-end-time" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">End Time</label>
                <input
                  id="settings-end-time"
                  type="time"
                  value={workSchedule.end_time}
                  onChange={e => setWorkSchedule({ ...workSchedule, end_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {/* Timezone Override */}
            <div>
              <label htmlFor="settings-timezone" className="block text-sm font-medium text-gray-900 dark:text-white mb-2">
                Timezone
                <span className="text-xs text-gray-400 font-normal ml-2">
                  Organization default: {orgTimezone}
                </span>
              </label>
              <select
                id="settings-timezone"
                value={workSchedule.timezone || ''}
                onChange={e => setWorkSchedule({ ...workSchedule, timezone: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
              >
                <option value="">Use organization default ({orgTimezone})</option>
                <option value="America/New_York">Eastern (America/New_York)</option>
                <option value="America/Chicago">Central (America/Chicago)</option>
                <option value="America/Denver">Mountain (America/Denver)</option>
                <option value="America/Los_Angeles">Pacific (America/Los_Angeles)</option>
                <option value="America/Anchorage">Alaska (America/Anchorage)</option>
                <option value="Pacific/Honolulu">Hawaii (Pacific/Honolulu)</option>
                <option value="Europe/London">London (Europe/London)</option>
                <option value="Europe/Paris">Central Europe (Europe/Paris)</option>
                <option value="Europe/Berlin">Berlin (Europe/Berlin)</option>
                <option value="Asia/Tokyo">Tokyo (Asia/Tokyo)</option>
                <option value="Asia/Shanghai">Shanghai (Asia/Shanghai)</option>
                <option value="Asia/Kolkata">India (Asia/Kolkata)</option>
                <option value="Australia/Sydney">Sydney (Australia/Sydney)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            {/* Monitoring Preferences */}
            <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-800">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Monitoring Preferences</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">After-hours work alerts</p>
                  <p className="text-xs text-gray-500">Flag activity outside your work schedule</p>
                </div>
                <button
                  role="switch"
                  aria-checked={workSchedule.after_hours_alert}
                  onClick={() => setWorkSchedule({ ...workSchedule, after_hours_alert: !workSchedule.after_hours_alert })}
                  className={`relative w-11 h-6 rounded-full transition ${
                    workSchedule.after_hours_alert ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    workSchedule.after_hours_alert ? 'translate-x-6' : 'translate-x-1'
                  } mt-1`} />
                </button>
              </div>

              <div>
                <label htmlFor="settings-idle-threshold" className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
                  Idle alert threshold
                  <span className="text-xs text-gray-400 ml-2">Minutes of inactivity before flagging</span>
                </label>
                <select
                  id="settings-idle-threshold"
                  value={workSchedule.idle_threshold_minutes}
                  onChange={e => setWorkSchedule({ ...workSchedule, idle_threshold_minutes: parseInt(e.target.value) })}
                  className="w-full sm:w-48 px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white text-sm"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours</option>
                </select>
              </div>
            </div>

            {/* Save */}
            <div className="flex justify-end pt-2">
              <button
                onClick={saveWorkSchedule}
                disabled={savingWorkSchedule}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {savingWorkSchedule ? 'Saving...' : 'Save Schedule'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Out of Office */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Palmtree aria-hidden="true" className="w-5 h-5" />
            Out of Office
          </h2>
          {!showAddOoo && (
            <button
              onClick={() => setShowAddOoo(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Add OOO
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Tag yourself as out of office for PTO or travel. Your scores, streaks, and alerts will be paused during this period.
        </p>

        {showAddOoo && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-surface-dark rounded-lg border border-gray-200 dark:border-border-dark space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ooo-start" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Start Date</label>
                <input
                  id="ooo-start"
                  type="date"
                  value={newOoo.start_date}
                  onChange={e => setNewOoo({ ...newOoo, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="ooo-end" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">End Date</label>
                <input
                  id="ooo-end"
                  type="date"
                  value={newOoo.end_date}
                  onChange={e => setNewOoo({ ...newOoo, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label htmlFor="ooo-type" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Type</label>
              <select
                id="ooo-type"
                value={newOoo.ooo_type}
                onChange={e => setNewOoo({ ...newOoo, ooo_type: e.target.value as 'pto' | 'travel' | 'sick' | 'other' })}
                className="w-full sm:w-48 px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
              >
                <option value="pto">PTO / Vacation</option>
                <option value="travel">Travel</option>
                <option value="sick">Sick Leave</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="ooo-note" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Note (optional)</label>
              <input
                id="ooo-note"
                type="text"
                value={newOoo.note}
                onChange={e => setNewOoo({ ...newOoo, note: e.target.value })}
                placeholder="e.g. Beach vacation, business trip to NYC"
                className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddOoo(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={createOooPeriod}
                disabled={savingOoo}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {savingOoo ? 'Saving...' : 'Create OOO Period'}
              </button>
            </div>
          </div>
        )}

        {oooLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          </div>
        ) : oooPeriods.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic">
            No active out-of-office periods. Click &quot;Add OOO&quot; to schedule time off.
          </p>
        ) : (
          <div className="space-y-2">
            {oooPeriods.map(period => {
              const typeIcon = period.oooType === 'travel' ? Plane
                : period.oooType === 'sick' ? Stethoscope
                : Palmtree
              const TypeIcon = typeIcon
              const typeLabel = period.oooType === 'pto' ? 'PTO'
                : period.oooType === 'travel' ? 'Travel'
                : period.oooType === 'sick' ? 'Sick'
                : 'Other'
              return (
                <div key={period.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-surface-dark rounded-lg border border-gray-200 dark:border-border-dark">
                  <div className="flex items-center gap-3">
                    <TypeIcon className="w-4 h-4 text-indigo-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {typeLabel}: {period.startDate} to {period.endDate}
                      </p>
                      {period.note && (
                        <p className="text-xs text-gray-500">{period.note}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => cancelOooPeriod(period.id)}
                    className="text-gray-400 hover:text-red-500 transition"
                    aria-label="Cancel OOO period"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Company Holidays (admin only) */}
      {isOrgAdmin && (
        <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="w-5 h-5" />
              Company Holidays
            </h2>
            {!showAddHoliday && (
              <button
                onClick={() => setShowAddHoliday(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
              >
                <Plus className="w-4 h-4" />
                Add Holiday
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            On company holidays, all team members are automatically treated as out of office. Scores, streaks, and alerts are paused for everyone.
          </p>

          {showAddHoliday && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-surface-dark rounded-lg border border-gray-200 dark:border-border-dark space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="holiday-name" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Holiday Name</label>
                  <input
                    id="holiday-name"
                    type="text"
                    value={newHoliday.name}
                    onChange={e => setNewHoliday({ ...newHoliday, name: e.target.value })}
                    placeholder="e.g. Christmas Day"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="holiday-date" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Date</label>
                  <input
                    id="holiday-date"
                    type="date"
                    value={newHoliday.date}
                    onChange={e => setNewHoliday({ ...newHoliday, date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-border-dark rounded-lg bg-white dark:bg-surface-dark text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={newHoliday.recurring}
                  onClick={() => setNewHoliday({ ...newHoliday, recurring: !newHoliday.recurring })}
                  className={`relative w-11 h-6 rounded-full transition ${
                    newHoliday.recurring ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    newHoliday.recurring ? 'translate-x-6' : 'translate-x-1'
                  } mt-1`} />
                </button>
                <span className="text-sm text-gray-700 dark:text-gray-300">Recurring every year</span>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddHoliday(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={addCompanyHoliday}
                  disabled={savingHoliday}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {savingHoliday ? 'Saving...' : 'Add Holiday'}
                </button>
              </div>
            </div>
          )}

          {holidaysLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-14 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
          ) : companyHolidays.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No company holidays configured. Add holidays like Christmas, New Year&apos;s, etc.
            </p>
          ) : (
            <div className="space-y-2">
              {companyHolidays.map(holiday => (
                <div key={holiday.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-surface-dark rounded-lg border border-gray-200 dark:border-border-dark">
                  <div className="flex items-center gap-3">
                    <CalendarDays className="w-4 h-4 text-indigo-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {holiday.name}
                        {holiday.recurring && (
                          <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">
                            Yearly
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">{holiday.date}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeCompanyHoliday(holiday.id)}
                    className="text-gray-400 hover:text-red-500 transition"
                    aria-label={`Remove ${holiday.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Saved with profile changes above</p>
          </div>

          {/* Company Domains */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Company Domains</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Add all email domains your company uses. Relationship health will only show contacts from these domains.
            </p>
            {domainsLoading ? (
              <div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
            ) : (
              <>
                <div className="space-y-2 mb-3">
                  {companyDomains.map((domain, i) => (
                    <div key={domain} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-surface-dark rounded-lg border border-gray-200 dark:border-border-dark">
                      <span className="text-sm text-gray-900 dark:text-white">{domain}</span>
                      {isOrgAdmin && (
                        <button onClick={() => removeCompanyDomain(i)} className="text-gray-400 hover:text-red-500 transition" aria-label={`Remove ${domain}`}>
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {companyDomains.length === 0 && (
                    <p className="text-sm text-gray-400 dark:text-gray-500 italic">No domains configured yet. Add your company&apos;s email domain.</p>
                  )}
                </div>
                {isOrgAdmin && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCompanyDomain()}
                      placeholder="e.g. acme.com"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                    />
                    <button onClick={addCompanyDomain} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
                      <Plus className="w-4 h-4" />
                    </button>
                    <button onClick={saveCompanyDomains} disabled={savingDomains} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
                      {savingDomains ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Team Members</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Manage your organization, departments, and teams from the <a href="/team-management" className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-medium">Team Management</a> page.</p>
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

          <a
            href="/team-management"
            className="block w-full px-4 py-2 border border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-500 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition text-center"
          >
            + Invite Team Member
          </a>
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

            {/* Folder Configuration */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Email Folder Rules</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Choose which folders to prioritize or exclude from missed email scanning. These are your personal settings.</p>
                </div>
                <button
                  onClick={loadOutlookFolders}
                  disabled={foldersLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition disabled:opacity-50"
                >
                  <RefreshCw aria-hidden="true" className={`w-3.5 h-3.5 ${foldersLoading ? 'animate-spin' : ''}`} />
                  {foldersLoading ? 'Loading...' : foldersLoaded ? 'Refresh Folders' : 'Load My Folders'}
                </button>
              </div>

              {/* Current selections */}
              {(emailPrefs.priority_folders.length > 0 || emailPrefs.excluded_folders.length > 0) && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {emailPrefs.priority_folders.map((folder, i) => (
                    <span key={`p-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 rounded-full border border-indigo-200 dark:border-indigo-800/50">
                      <Star aria-hidden="true" className="w-3 h-3" />
                      {folder}
                      <button
                        onClick={() => setEmailPrefs({ ...emailPrefs, priority_folders: emailPrefs.priority_folders.filter((_, idx) => idx !== i) })}
                        className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                      >
                        <X aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {emailPrefs.excluded_folders.map((folder, i) => (
                    <span key={`e-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-full border border-red-200 dark:border-red-800/50">
                      <ShieldBan aria-hidden="true" className="w-3 h-3" />
                      {folder}
                      <button
                        onClick={() => setEmailPrefs({ ...emailPrefs, excluded_folders: emailPrefs.excluded_folders.filter((_, idx) => idx !== i) })}
                        className="text-red-400 hover:text-red-600 dark:hover:text-red-300"
                      >
                        <X aria-hidden="true" className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Folder list from Outlook */}
              {foldersLoaded && outlookFolders.length > 0 && (
                <div className="border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-0 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-surface-dark px-4 py-2 border-b border-gray-200 dark:border-border-dark">
                    <span>Folder</span>
                    <span className="text-center w-20">Priority</span>
                    <span className="text-center w-20">Exclude</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {outlookFolders.map((folder) => {
                      const isPriority = emailPrefs.priority_folders.includes(folder.name)
                      const isExcluded = emailPrefs.excluded_folders.includes(folder.name)
                      return (
                        <div key={folder.id} className="grid grid-cols-[1fr_auto_auto] gap-0 items-center px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/5 transition">
                          <div className="flex items-center gap-2 min-w-0">
                            <Folder aria-hidden="true" className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            <span className="text-sm text-gray-900 dark:text-white truncate">{folder.name}</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                              {folder.totalCount.toLocaleString()}
                              {folder.unreadCount > 0 && (
                                <span className="text-blue-500 ml-1">({folder.unreadCount} unread)</span>
                              )}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              if (isPriority) {
                                setEmailPrefs({ ...emailPrefs, priority_folders: emailPrefs.priority_folders.filter(f => f !== folder.name) })
                              } else {
                                // Remove from excluded if adding to priority
                                const newExcluded = emailPrefs.excluded_folders.filter(f => f !== folder.name)
                                setEmailPrefs({ ...emailPrefs, priority_folders: [...emailPrefs.priority_folders, folder.name], excluded_folders: newExcluded })
                              }
                            }}
                            className={`w-20 flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition ${
                              isPriority
                                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700'
                                : 'text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10'
                            }`}
                          >
                            {isPriority ? <><Check aria-hidden="true" className="w-3 h-3" /> Priority</> : <><Star aria-hidden="true" className="w-3 h-3" /> Priority</>}
                          </button>
                          <button
                            onClick={() => {
                              if (isExcluded) {
                                setEmailPrefs({ ...emailPrefs, excluded_folders: emailPrefs.excluded_folders.filter(f => f !== folder.name) })
                              } else {
                                // Remove from priority if adding to excluded
                                const newPriority = emailPrefs.priority_folders.filter(f => f !== folder.name)
                                setEmailPrefs({ ...emailPrefs, excluded_folders: [...emailPrefs.excluded_folders, folder.name], priority_folders: newPriority })
                              }
                            }}
                            className={`w-20 flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition ${
                              isExcluded
                                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700'
                                : 'text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10'
                            }`}
                          >
                            {isExcluded ? <><Check aria-hidden="true" className="w-3 h-3" /> Exclude</> : <><ShieldBan aria-hidden="true" className="w-3 h-3" /> Exclude</>}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Fallback manual entry when folders haven't been loaded */}
              {!foldersLoaded && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Add priority folder manually</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newPriorityFolder}
                        onChange={(e) => setNewPriorityFolder(e.target.value)}
                        placeholder="Folder name (e.g. Inbox)"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newPriorityFolder.trim()) {
                            const name = newPriorityFolder.trim()
                            if (!emailPrefs.priority_folders.includes(name)) {
                              setEmailPrefs({ ...emailPrefs, priority_folders: [...emailPrefs.priority_folders, name] })
                            }
                            setNewPriorityFolder('')
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const name = newPriorityFolder.trim()
                          if (name && !emailPrefs.priority_folders.includes(name)) {
                            setEmailPrefs({ ...emailPrefs, priority_folders: [...emailPrefs.priority_folders, name] })
                          }
                          setNewPriorityFolder('')
                        }}
                        className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">Add excluded folder manually</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newExcludedFolder}
                        onChange={(e) => setNewExcludedFolder(e.target.value)}
                        placeholder="Folder name (e.g. Junk Email)"
                        className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newExcludedFolder.trim()) {
                            const name = newExcludedFolder.trim()
                            if (!emailPrefs.excluded_folders.includes(name)) {
                              setEmailPrefs({ ...emailPrefs, excluded_folders: [...emailPrefs.excluded_folders, name] })
                            }
                            setNewExcludedFolder('')
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const name = newExcludedFolder.trim()
                          if (name && !emailPrefs.excluded_folders.includes(name)) {
                            setEmailPrefs({ ...emailPrefs, excluded_folders: [...emailPrefs.excluded_folders, name] })
                          }
                          setNewExcludedFolder('')
                        }}
                        className="px-3 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Emails below this threshold won&apos;t appear on your dashboard</p>
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
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Choose which types of emails to flag. Disable categories you don&apos;t care about.</p>
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

      {/* Gamification Notifications */}
      <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <Trophy aria-hidden="true" className="w-5 h-5" />
          Gamification Notifications
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Choose which gamification events trigger notifications for you.
        </p>

        {gamificationPrefsLoading ? (
          <div className="animate-pulse space-y-4" role="status" aria-busy="true" aria-label="Loading gamification notification preferences">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg"></div>)}
          </div>
        ) : (
          <div className="space-y-4">
            {([
              {
                id: 'achievement_notifications' as const,
                label: 'Achievement Notifications',
                description: 'Notify when you earn badges and achievements',
              },
              {
                id: 'streak_notifications' as const,
                label: 'Streak Notifications',
                description: 'Notify about streak milestones and streaks at risk',
              },
              {
                id: 'leaderboard_notifications' as const,
                label: 'Leaderboard Notifications',
                description: 'Notify when your rank changes on the leaderboard',
              },
              {
                id: 'challenge_notifications' as const,
                label: 'Challenge Notifications',
                description: 'Notify about team challenge progress and completions',
              },
              {
                id: 'weekly_digest' as const,
                label: 'Weekly Digest',
                description: 'Receive a weekly summary of your gamification stats',
              },
              {
                id: 'celebration_posts' as const,
                label: 'Celebration Posts (Public)',
                description: 'Post your achievements to the team channel',
              },
            ]).map((setting) => (
              <div key={setting.id} className="flex items-center justify-between p-4 border border-gray-100 dark:border-gray-700 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{setting.label}</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{setting.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={gamificationPrefs[setting.id]}
                  aria-label={setting.label}
                  onClick={() => toggleGamificationPref(setting.id)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    gamificationPrefs[setting.id]
                      ? 'bg-indigo-600'
                      : 'bg-gray-200 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      gamificationPrefs[setting.id] ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
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

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Change Password</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">New Password</label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-900 dark:text-white mb-1">Confirm Password</label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-border-dark rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-surface-dark dark:text-white"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowPasswordModal(false); setNewPassword(''); setConfirmPassword('') }}
                  className="px-4 py-2 border border-gray-300 dark:border-border-dark text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={savingPassword}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingPassword ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
