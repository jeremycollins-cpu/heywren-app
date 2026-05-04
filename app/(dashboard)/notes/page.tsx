'use client'

// /notes — capture page for the Notes feature.
//
// Two views toggled at the top right:
//   - Timeline: notes grouped by date (note_date), newest first
//   - Topics: hierarchical topic tree on the left, notes for the selected topic on the right
//
// Upload: click "+ New note" → multi-file picker → POST /api/notes (FormData).
// Search: typing in the search bar swaps the list for /api/notes/search?q= results.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  StickyNote, Plus, Search, Calendar, FolderTree, Folder, FolderPlus,
  Loader2, ChevronRight, ChevronDown, X, Trash2, MoreHorizontal,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface Note {
  id: string
  title: string | null
  summary: string | null
  status: 'processing' | 'ready' | 'failed'
  topic_id: string | null
  note_date: string
  created_at: string
}

interface Topic {
  id: string
  name: string
  color: string
  parent_id: string | null
  user_id: string
  note_count: number
}

type ViewMode = 'timeline' | 'topics'

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewMode>('timeline')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Note[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null) // 'none' for uncategorized
  const [uploading, setUploading] = useState(false)
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicParent, setNewTopicParent] = useState<string | null>(null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = async () => {
    setLoading(true)
    const [notesRes, topicsRes] = await Promise.all([
      fetch('/api/notes', { cache: 'no-store' }),
      fetch('/api/notes/topics', { cache: 'no-store' }),
    ])
    if (notesRes.ok) {
      const j = await notesRes.json()
      setNotes(j.notes || [])
    }
    if (topicsRes.ok) {
      const j = await topicsRes.json()
      setTopics(j.topics || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Poll while any note is still processing so the row flips to "ready" without a manual refresh.
  useEffect(() => {
    const anyProcessing = notes.some(n => n.status === 'processing')
    if (!anyProcessing) return
    const t = setInterval(fetchData, 4000)
    return () => clearInterval(t)
  }, [notes])

  // Debounced search.
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    const handle = setTimeout(async () => {
      setSearching(true)
      const res = await fetch(`/api/notes/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const j = await res.json()
        setSearchResults(j.notes || [])
      }
      setSearching(false)
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery])

  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    const fd = new FormData()
    for (const f of files) fd.append('images', f)
    if (view === 'topics' && selectedTopicId && selectedTopicId !== 'none') {
      fd.append('topic_id', selectedTopicId)
    }
    const res = await fetch('/api/notes', { method: 'POST', body: fd })
    setUploading(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || 'Upload failed')
      return
    }
    toast.success(`Uploaded ${files.length} image${files.length === 1 ? '' : 's'}. Wren is reading…`)
    fetchData()
  }

  const handleCreateTopic = async () => {
    const name = newTopicName.trim()
    if (!name) return
    const res = await fetch('/api/notes/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent_id: newTopicParent }),
    })
    if (!res.ok) {
      toast.error('Failed to create topic')
      return
    }
    setNewTopicName('')
    setNewTopicParent(null)
    setShowNewTopic(false)
    fetchData()
  }

  const handleDeleteTopic = async (id: string) => {
    if (!confirm('Delete this topic? Notes inside it become uncategorized.')) return
    const res = await fetch(`/api/notes/topics?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      if (selectedTopicId === id) setSelectedTopicId(null)
      fetchData()
    }
  }

  // Build topic tree.
  const topicTree = useMemo(() => {
    const byParent = new Map<string | null, Topic[]>()
    for (const t of topics) {
      const list = byParent.get(t.parent_id) || []
      list.push(t)
      byParent.set(t.parent_id, list)
    }
    return byParent
  }, [topics])

  const visibleNotes = useMemo(() => {
    if (searchResults) return searchResults
    if (view === 'timeline') return notes
    if (selectedTopicId === 'none') return notes.filter(n => !n.topic_id)
    if (selectedTopicId) {
      // Include descendants of the selected topic.
      const descendants = new Set<string>([selectedTopicId])
      const queue = [selectedTopicId]
      while (queue.length) {
        const cur = queue.shift()!
        for (const child of (topicTree.get(cur) || [])) {
          if (!descendants.has(child.id)) {
            descendants.add(child.id)
            queue.push(child.id)
          }
        }
      }
      return notes.filter(n => n.topic_id && descendants.has(n.topic_id))
    }
    return notes
  }, [searchResults, view, notes, selectedTopicId, topicTree])

  // Group by date for timeline view.
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Note[]>()
    for (const n of visibleNotes) {
      const list = map.get(n.note_date) || []
      list.push(n)
      map.set(n.note_date, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [visibleNotes])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <StickyNote className="w-7 h-7 text-indigo-600" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notes</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Snap a photo. Wren turns it into searchable, organized notes.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files || [])
              if (files.length) handleUpload(files)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New note
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark-secondary text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark-tertiary rounded-lg p-1">
          <button
            onClick={() => setView('timeline')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'timeline' ? 'bg-white dark:bg-surface-dark-secondary shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'}`}
          >
            <Calendar className="w-4 h-4" aria-hidden="true" /> Timeline
          </button>
          <button
            onClick={() => setView('topics')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'topics' ? 'bg-white dark:bg-surface-dark-secondary shadow text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900'}`}
          >
            <FolderTree className="w-4 h-4" aria-hidden="true" /> Topics
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading notes…
        </div>
      ) : view === 'timeline' || searchResults ? (
        <TimelineList grouped={groupedByDate} searching={searching} searchActive={!!searchResults} topics={topics} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <TopicTree
            topics={topics}
            tree={topicTree}
            expanded={expandedTopics}
            onToggle={id => {
              setExpandedTopics(prev => {
                const n = new Set(prev)
                if (n.has(id)) n.delete(id); else n.add(id)
                return n
              })
            }}
            selected={selectedTopicId}
            onSelect={setSelectedTopicId}
            onNew={() => setShowNewTopic(true)}
            onDelete={handleDeleteTopic}
            uncategorizedCount={notes.filter(n => !n.topic_id).length}
          />
          <NoteCardList notes={visibleNotes} topics={topics} />
        </div>
      )}

      {/* New topic modal */}
      {showNewTopic && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-surface-dark-secondary rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">New topic</h2>
            <input
              autoFocus
              type="text"
              placeholder="Topic name (e.g. Q3 Planning)"
              value={newTopicName}
              onChange={e => setNewTopicName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm mb-3 bg-white dark:bg-surface-dark-tertiary"
            />
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Parent topic (optional)</label>
            <select
              value={newTopicParent || ''}
              onChange={e => setNewTopicParent(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-border-dark rounded-lg text-sm bg-white dark:bg-surface-dark-tertiary"
            >
              <option value="">(top level)</option>
              {topics.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowNewTopic(false); setNewTopicName(''); setNewTopicParent(null) }}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg"
              >Cancel</button>
              <button
                onClick={handleCreateTopic}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold"
              >Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Timeline view ──────────────────────────────────────────────────────────

function TimelineList({
  grouped, searching, searchActive, topics,
}: {
  grouped: Array<[string, Note[]]>
  searching: boolean
  searchActive: boolean
  topics: Topic[]
}) {
  if (searching) {
    return <div className="text-center py-12 text-gray-500"><Loader2 className="inline w-4 h-4 animate-spin mr-2" /> Searching…</div>
  }
  if (grouped.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500 dark:text-gray-400">
        {searchActive ? 'No notes match your search.' : 'No notes yet. Click "New note" to upload your first photo.'}
      </div>
    )
  }
  return (
    <div className="space-y-8">
      {grouped.map(([date, dayNotes]) => (
        <div key={date}>
          <h3 className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-3">
            {formatDateHeader(date)}
          </h3>
          <NoteCardList notes={dayNotes} topics={topics} />
        </div>
      ))}
    </div>
  )
}

function formatDateHeader(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Note card list ─────────────────────────────────────────────────────────

function NoteCardList({ notes, topics }: { notes: Note[]; topics: Topic[] }) {
  if (notes.length === 0) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">No notes here yet.</div>
  }
  const topicMap = new Map(topics.map(t => [t.id, t]))
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {notes.map(n => {
        const topic = n.topic_id ? topicMap.get(n.topic_id) : null
        return (
          <Link
            href={`/notes/${n.id}`}
            key={n.id}
            className="block p-4 bg-white dark:bg-surface-dark-secondary rounded-lg border border-gray-200 dark:border-border-dark hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-1 flex-1">
                {n.title || (n.status === 'processing' ? 'Processing…' : 'Untitled note')}
              </h4>
              {n.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" aria-hidden="true" />}
              {n.status === 'failed' && <span className="text-xs text-red-600">failed</span>}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-3 whitespace-pre-line">
              {n.summary || '—'}
            </p>
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
              <span>{new Date(n.note_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              {topic && (
                <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300">
                  {topic.name}
                </span>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ─── Topic tree ─────────────────────────────────────────────────────────────

function TopicTree({
  topics, tree, expanded, onToggle, selected, onSelect, onNew, onDelete, uncategorizedCount,
}: {
  topics: Topic[]
  tree: Map<string | null, Topic[]>
  expanded: Set<string>
  onToggle: (id: string) => void
  selected: string | null
  onSelect: (id: string | null) => void
  onNew: () => void
  onDelete: (id: string) => void
  uncategorizedCount: number
}) {
  const renderNode = (topic: Topic, depth: number): React.ReactNode => {
    const children = tree.get(topic.id) || []
    const hasChildren = children.length > 0
    const isExpanded = expanded.has(topic.id)
    return (
      <div key={topic.id}>
        <div
          className={`group flex items-center gap-1 py-1.5 pr-2 rounded-md cursor-pointer transition-colors ${selected === topic.id ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={() => onSelect(topic.id)}
        >
          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); onToggle(topic.id) }}
              className="flex-shrink-0 p-0.5 hover:bg-black/5 dark:hover:bg-white/10 rounded"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <Folder className="w-4 h-4 flex-shrink-0 opacity-70" aria-hidden="true" />
          <span className="text-sm flex-1 truncate">{topic.name}</span>
          {topic.note_count > 0 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5">{topic.note_count}</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDelete(topic.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600"
            aria-label="Delete topic"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>{children.map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-surface-dark-secondary rounded-lg border border-gray-200 dark:border-border-dark p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Topics</h3>
        <button
          onClick={onNew}
          className="p-1 text-gray-500 hover:text-indigo-600"
          aria-label="New topic"
          title="New topic"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      </div>
      <div
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer text-sm ${selected === null ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`}
      >
        <StickyNote className="w-4 h-4 opacity-70" aria-hidden="true" /> All notes
      </div>
      <div
        onClick={() => onSelect('none')}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer text-sm ${selected === 'none' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`}
      >
        <Folder className="w-4 h-4 opacity-70" aria-hidden="true" /> Uncategorized
        {uncategorizedCount > 0 && (
          <span className="ml-auto text-[10px] text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5">{uncategorizedCount}</span>
        )}
      </div>
      <div className="mt-2">
        {(tree.get(null) || []).map(t => renderNode(t, 0))}
      </div>
      {topics.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 px-2">No topics yet. Wren will suggest one when you upload.</p>
      )}
    </div>
  )
}
