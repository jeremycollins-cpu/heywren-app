'use client'

import { useState } from 'react'
import { FileText, Plus, CheckCircle2, Trash2 } from 'lucide-react'

interface Playbook {
  id: string
  name: string
  description: string
  trigger: string
  action: string
  enabled: boolean
}

const mockPlaybooks: Playbook[] = [
  {
    id: '1',
    name: 'Customer Success Follow-up',
    description: 'Auto-send follow-up after customer calls',
    trigger: 'When a call with customer ends',
    action: 'Schedule follow-up email in 24 hours',
    enabled: true,
  },
  {
    id: '2',
    name: 'Stalled Deal Alert',
    description: 'Flag deals that haven\'t moved in 14 days',
    trigger: 'Salesforce deal unchanged for 14 days',
    action: 'Create Slack reminder and ping manager',
    enabled: true,
  },
  {
    id: '3',
    name: 'Weekly Executive Summary',
    description: 'Auto-generate weekly status for leadership',
    trigger: 'Every Friday at 5pm',
    action: 'Send summary to exec email list',
    enabled: true,
  },
  {
    id: '4',
    name: 'Onboarding Checkpoint',
    description: 'Track new employee onboarding progress',
    trigger: 'New user added to Slack',
    action: 'Create checklist and track completion',
    enabled: false,
  },
  {
    id: '5',
    name: 'At-Risk Account Alert',
    description: 'Flag accounts showing churn signals',
    trigger: 'Account engagement drops 40%',
    action: 'Alert customer success team',
    enabled: true,
  },
]

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState(mockPlaybooks)

  const togglePlaybook = (id: string) => {
    setPlaybooks(playbooks.map(p =>
      p.id === id ? { ...p, enabled: !p.enabled } : p
    ))
  }

  const deletePlaybook = (id: string) => {
    setPlaybooks(playbooks.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Playbooks</h1>
          <p className="text-gray-600 mt-1">
            Rules that automate how HeyWren handles your commitments — define once, enforce forever
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
          <Plus className="w-5 h-5" />
          New Playbook
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Total Playbooks</p>
          <p className="text-3xl font-bold text-gray-900">{playbooks.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Active</p>
          <p className="text-3xl font-bold text-green-600">{playbooks.filter(p => p.enabled).length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-sm text-gray-600 mb-1">Actions Automated</p>
          <p className="text-3xl font-bold text-indigo-600">847</p>
        </div>
      </div>

      {/* Playbooks List */}
      <div className="space-y-3">
        {playbooks.map((playbook) => (
          <div
            key={playbook.id}
            className={`border rounded-lg p-6 transition-all ${
              playbook.enabled
                ? 'bg-white border-gray-200 hover:shadow-md'
                : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-2 h-2 rounded-full ${playbook.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <h3 className="font-semibold text-gray-900">{playbook.name}</h3>
                </div>
                <p className="text-sm text-gray-600">{playbook.description}</p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => togglePlaybook(playbook.id)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <div className={`w-5 h-5 rounded flex items-center justify-center ${playbook.enabled ? 'bg-green-600' : 'bg-gray-400'}`}>
                    {playbook.enabled && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                </button>
                <button
                  onClick={() => deletePlaybook(playbook.id)}
                  className="p-2 hover:bg-red-50 rounded-lg transition text-red-600"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Trigger</p>
                <div className="bg-gray-50 rounded p-3 text-sm text-gray-700">
                  {playbook.trigger}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Action</p>
                <div className="bg-indigo-50 rounded p-3 text-sm text-indigo-700">
                  {playbook.action}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
        <h3 className="font-semibold text-indigo-900 mb-2">How Playbooks Work</h3>
        <p className="text-sm text-indigo-800 mb-3">
          Create custom automation rules to handle repetitive workflows and ensure consistent follow-through.
        </p>
        <ul className="text-sm text-indigo-800 space-y-1">
          <li>✓ Define triggers based on calendar, email, or tool events</li>
          <li>✓ Set actions like notifications, scheduling, or automated messages</li>
          <li>✓ Track execution metrics for each playbook</li>
          <li>✓ No-code rule builder — anyone can create playbooks</li>
        </ul>
      </div>
    </div>
  )
}
