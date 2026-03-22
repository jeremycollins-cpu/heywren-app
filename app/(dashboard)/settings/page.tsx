'use client'

import { useState } from 'react'
import { Settings as SettingsIcon, Bell, Lock, Users, Mail } from 'lucide-react'

export default function SettingsPage() {
  const [notifications, setNotifications] = useState({
    slack: true,
    email: true,
    overdue: true,
    weekly: true,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">
          Manage your profile, notifications, and privacy preferences
        </p>
      </div>

      {/* Profile Settings */}
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
              defaultValue="Alex Johnson"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Email</label>
            <input
              type="email"
              defaultValue="alex@company.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Role</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
              <option>CEO</option>
              <option>VP Sales</option>
              <option>VP Product</option>
              <option>VP Engineering</option>
              <option>Manager</option>
            </select>
          </div>

          <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
            Save Changes
          </button>
        </div>
      </div>

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
              defaultValue="My Company"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4">Team Members</h3>
            <div className="space-y-3">
              {[
                { name: 'Sarah Chen', role: 'Admin', email: 'sarah@company.com' },
                { name: 'Michael Rodriguez', role: 'Member', email: 'michael@company.com' },
                { name: 'Emma Thompson', role: 'Member', email: 'emma@company.com' },
              ].map((member) => (
                <div key={member.email} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{member.name}</p>
                    <p className="text-sm text-gray-600">{member.email}</p>
                  </div>
                  <select defaultValue={member.role} className="px-3 py-1 text-sm border border-gray-300 rounded-lg">
                    <option>Admin</option>
                    <option>Member</option>
                    <option>Viewer</option>
                  </select>
                </div>
              ))}
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

        <div className="space-y-3">
          {[
            { name: 'Slack', connected: true },
            { name: 'Outlook', connected: true },
            { name: 'Google Calendar', connected: true },
            { name: 'Asana', connected: true },
            { name: 'Salesforce', connected: false },
            { name: 'Jira', connected: false },
          ].map((integration) => (
            <div key={integration.name} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-lg" />
                <p className="font-medium text-gray-900">{integration.name}</p>
              </div>
              <button className={`px-4 py-2 rounded-lg transition ${
                integration.connected
                  ? 'bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}>
                {integration.connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
