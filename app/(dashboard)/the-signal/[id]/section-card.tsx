'use client'

// Renders + edits a single section of a monthly briefing.
// Click "Edit" to mutate title/summary/bullets; Save persists to the API.

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, AlertOctagon, Edit3, Pin, PinOff, Save, Trash2, X, Plus, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { BriefingBullet, BriefingSection } from '@/lib/monthly-briefing/types'

interface Props {
  briefingId: string
  section: BriefingSection
  active: boolean
  onSelect: () => void
  onUpdated: (section: BriefingSection) => void
  onDeleted: (sectionId: string) => void
}

const SEV_STYLES: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
  positive: { cls: 'border-emerald-300 bg-emerald-50/50', Icon: CheckCircle2 },
  info:     { cls: 'border-gray-200 bg-white',             Icon: Circle },
  watch:    { cls: 'border-amber-300 bg-amber-50/50',      Icon: AlertTriangle },
  critical: { cls: 'border-red-300 bg-red-50/50',          Icon: AlertOctagon },
}

export default function SectionCard({ briefingId, section, active, onSelect, onUpdated, onDeleted }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(section.title)
  const [summary, setSummary] = useState(section.summary || '')
  const [bullets, setBullets] = useState<BriefingBullet[]>(section.bullets || [])

  const cancel = () => {
    setTitle(section.title)
    setSummary(section.summary || '')
    setBullets(section.bullets || [])
    setEditing(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/the-signal/${briefingId}/sections/${section.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, summary, bullets }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not save section.')
        return
      }
      onUpdated(json.section)
      setEditing(false)
      toast.success('Section saved.')
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async () => {
    try {
      const res = await fetch(`/api/the-signal/${briefingId}/sections/${section.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !section.pinned }),
      })
      const json = await res.json()
      if (res.ok) {
        onUpdated(json.section)
        toast.success(json.section.pinned ? 'Section pinned — it will survive regenerations.' : 'Section unpinned.')
      }
    } catch { /* ignore */ }
  }

  const remove = async () => {
    if (!confirm(`Delete the "${section.title}" section?`)) return
    try {
      const res = await fetch(`/api/the-signal/${briefingId}/sections/${section.id}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted(section.id)
        toast.success('Section deleted.')
      }
    } catch { /* ignore */ }
  }

  const updateBullet = (idx: number, patch: Partial<BriefingBullet>) => {
    setBullets(prev => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)))
  }
  const addBullet = () => setBullets(prev => [...prev, { heading: 'New bullet', detail: '', severity: 'info' }])
  const removeBullet = (idx: number) => setBullets(prev => prev.filter((_, i) => i !== idx))

  return (
    <div
      id={`section-${section.id}`}
      onClick={onSelect}
      className={`bg-white dark:bg-gray-900 border rounded-2xl p-5 transition-all cursor-pointer ${
        active
          ? 'border-indigo-400 dark:border-indigo-600 shadow-sm'
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onClick={e => e.stopPropagation()}
              className="w-full font-bold text-lg text-gray-900 dark:text-white bg-transparent border-b border-gray-300 focus:border-indigo-500 outline-none"
            />
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">{section.title}</h3>
              {section.pinned && <Pin className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />}
              {section.user_edited && !editing && (
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Edited</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          {editing ? (
            <>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              <button
                onClick={cancel}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={togglePin}
                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
                title={section.pinned ? 'Unpin' : 'Pin (survives regenerations)'}
              >
                {section.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
                title="Edit section"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={remove}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                title="Delete section"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      {editing ? (
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          onClick={e => e.stopPropagation()}
          rows={2}
          placeholder="Section summary…"
          className="w-full text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 mb-3 outline-none focus:border-indigo-500"
        />
      ) : (
        section.summary && (
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{section.summary}</p>
        )
      )}

      {/* Bullets */}
      <div className="space-y-2">
        {(editing ? bullets : section.bullets || []).map((b, idx) => {
          const sev = SEV_STYLES[b.severity || 'info'] || SEV_STYLES.info
          return editing ? (
            <div key={idx} className={`border rounded-lg p-2 ${sev.cls}`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-1">
                <select
                  value={b.severity || 'info'}
                  onChange={e => updateBullet(idx, { severity: e.target.value as BriefingBullet['severity'] })}
                  className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white"
                >
                  <option value="info">info</option>
                  <option value="positive">positive</option>
                  <option value="watch">watch</option>
                  <option value="critical">critical</option>
                </select>
                <input
                  value={b.heading}
                  onChange={e => updateBullet(idx, { heading: e.target.value })}
                  placeholder="Heading"
                  className="flex-1 text-sm font-semibold bg-transparent border-b border-gray-200 focus:border-indigo-500 outline-none"
                />
                <button onClick={() => removeBullet(idx)} className="text-gray-400 hover:text-red-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <textarea
                value={b.detail}
                onChange={e => updateBullet(idx, { detail: e.target.value })}
                placeholder="Detail"
                rows={2}
                className="w-full text-sm text-gray-700 bg-transparent outline-none resize-none"
              />
              <input
                value={b.evidence || ''}
                onChange={e => updateBullet(idx, { evidence: e.target.value })}
                placeholder="Evidence (optional)"
                className="w-full text-xs text-gray-500 bg-transparent outline-none italic"
              />
            </div>
          ) : (
            <div key={idx} className={`border rounded-lg p-3 ${sev.cls}`}>
              <div className="flex items-start gap-2">
                <sev.Icon
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    b.severity === 'positive' ? 'text-emerald-600' :
                    b.severity === 'watch' ? 'text-amber-600' :
                    b.severity === 'critical' ? 'text-red-600' : 'text-gray-400'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">{b.heading}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{b.detail}</p>
                  {b.evidence && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-1">{b.evidence}</p>
                  )}
                  {b.source && (
                    <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-1">Source: {b.source}</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {editing && (
          <button
            onClick={addBullet}
            className="w-full inline-flex items-center justify-center gap-1 py-2 text-xs font-medium text-gray-500 border-2 border-dashed border-gray-200 rounded-lg hover:text-indigo-600 hover:border-indigo-300"
          >
            <Plus className="w-3 h-3" />
            Add bullet
          </button>
        )}
      </div>
    </div>
  )
}
