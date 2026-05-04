'use client'

// /notes/[id] — single-note view
//
// Layout:
//   Top bar: title (editable), date, topic picker, delete
//   Image carousel with download buttons (signed URL per click)
//   AI summary card (read-only)
//   Editable body (textarea, debounced save)
//   Extracted todos / commitments panel — accept or dismiss
//   "Add more images" button at the bottom

import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Download, Plus, Trash2, ChevronLeft, ChevronRight,
  CheckCircle2, X, ListChecks, Clock, Save,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface Note {
  id: string
  title: string | null
  summary: string | null
  transcription: string | null
  body: string | null
  status: 'processing' | 'ready' | 'failed'
  failure_reason: string | null
  topic_id: string | null
  note_date: string
  extracted_actions: {
    todos: Array<{ title: string; accepted: boolean; dismissed: boolean }>
    commitments: Array<{ title: string; accepted: boolean; dismissed: boolean }>
  }
  created_at: string
  updated_at: string
}

interface NoteImage {
  id: string
  storage_path: string
  original_name: string | null
  mime_type: string
  position: number
  transcription: string | null
  signed_url: string | null
}

interface Topic {
  id: string
  name: string
  parent_id: string | null
}

export default function NoteDetailPage() {
  const params = useParams() as { id: string }
  const router = useRouter()
  const [note, setNote] = useState<Note | null>(null)
  const [images, setImages] = useState<NoteImage[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [activeImage, setActiveImage] = useState(0)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [savingBody, setSavingBody] = useState(false)
  const [bodyDirty, setBodyDirty] = useState(false)
  const [adding, setAdding] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchNote = async () => {
    const [nRes, tRes] = await Promise.all([
      fetch(`/api/notes/${params.id}`, { cache: 'no-store' }),
      fetch('/api/notes/topics', { cache: 'no-store' }),
    ])
    if (nRes.ok) {
      const j = await nRes.json()
      setNote(j.note)
      setImages(j.images || [])
      setTitleDraft(j.note.title || '')
      if (!bodyDirty) setBodyDraft(j.note.body || '')
    }
    if (tRes.ok) {
      const j = await tRes.json()
      setTopics(j.topics || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchNote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  // Poll while processing.
  useEffect(() => {
    if (!note || note.status !== 'processing') return
    const t = setInterval(fetchNote, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.status])

  // Debounced body autosave.
  useEffect(() => {
    if (!bodyDirty || !note) return
    const handle = setTimeout(async () => {
      setSavingBody(true)
      await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: bodyDraft }),
      })
      setSavingBody(false)
      setBodyDirty(false)
    }, 800)
    return () => clearTimeout(handle)
  }, [bodyDraft, bodyDirty, note])

  const saveTitle = async () => {
    if (!note) return
    if (titleDraft.trim() === (note.title || '')) return
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleDraft.trim() }),
    })
    fetchNote()
  }

  const handleTopicChange = async (topicId: string) => {
    if (!note) return
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: topicId || null }),
    })
    fetchNote()
  }

  const handleDateChange = async (date: string) => {
    if (!note) return
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note_date: date }),
    })
    fetchNote()
  }

  const handleDelete = async () => {
    if (!note) return
    if (!confirm('Delete this note? This cannot be undone.')) return
    const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Note deleted')
      router.push('/notes')
    }
  }

  const handleAddImages = async (files: File[]) => {
    if (!note || files.length === 0) return
    setAdding(true)
    const fd = new FormData()
    for (const f of files) fd.append('images', f)
    const res = await fetch(`/api/notes/${note.id}/images`, { method: 'POST', body: fd })
    setAdding(false)
    if (!res.ok) {
      toast.error('Failed to add images')
      return
    }
    toast.success('Added. Wren is re-reading the note…')
    fetchNote()
  }

  const handleDownloadImage = async (imageId: string) => {
    if (!note) return
    const res = await fetch(`/api/notes/${note.id}/images/${imageId}?download=1`)
    if (!res.ok) {
      toast.error('Failed to fetch download link')
      return
    }
    const j = await res.json()
    if (j.signed_url) window.open(j.signed_url, '_blank')
  }

  const handleDeleteImage = async (imageId: string) => {
    if (!note) return
    if (images.length === 1) {
      toast.error('Cannot delete the last image. Delete the whole note instead.')
      return
    }
    if (!confirm('Remove this image from the note?')) return
    await fetch(`/api/notes/${note.id}/images/${imageId}`, { method: 'DELETE' })
    if (activeImage >= images.length - 1) setActiveImage(Math.max(0, images.length - 2))
    fetchNote()
  }

  const handleAction = async (kind: 'todo' | 'commitment', index: number, action: 'accept' | 'dismiss') => {
    if (!note) return
    const res = await fetch(`/api/notes/${note.id}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, index, action }),
    })
    if (!res.ok) {
      toast.error('Action failed')
      return
    }
    if (action === 'accept' && kind === 'todo') toast.success('Added to To-Dos')
    if (action === 'accept' && kind === 'commitment') toast.success('Added to Commitments')
    fetchNote()
  }

  const visibleTodos = useMemo(() => {
    if (!note) return []
    return note.extracted_actions.todos
      .map((t, i) => ({ ...t, idx: i }))
      .filter(t => !t.accepted && !t.dismissed)
  }, [note])

  const visibleCommitments = useMemo(() => {
    if (!note) return []
    return note.extracted_actions.commitments
      .map((c, i) => ({ ...c, idx: i }))
      .filter(c => !c.accepted && !c.dismissed)
  }, [note])

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500"><Loader2 className="inline w-5 h-5 animate-spin mr-2" /> Loading…</div>
    )
  }
  if (!note) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-gray-500">Note not found.</p>
        <Link href="/notes" className="text-indigo-600 hover:underline mt-2 inline-block">Back to Notes</Link>
      </div>
    )
  }

  const currentImage = images[activeImage]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <Link href="/notes" className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> All notes
        </Link>
        <button
          onClick={handleDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete note
        </button>
      </div>

      {/* Title + meta */}
      <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 mb-4">
        <input
          type="text"
          value={titleDraft}
          onChange={e => setTitleDraft(e.target.value)}
          onBlur={saveTitle}
          placeholder={note.status === 'processing' ? 'Wren is reading your note…' : 'Untitled note'}
          className="w-full text-xl font-semibold bg-transparent text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1"
        />
        <div className="flex items-center gap-4 mt-3 flex-wrap text-sm">
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <Clock className="w-4 h-4" aria-hidden="true" />
            <input
              type="date"
              value={note.note_date}
              onChange={e => handleDateChange(e.target.value)}
              className="bg-transparent border border-gray-200 dark:border-border-dark rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <ListChecks className="w-4 h-4" aria-hidden="true" />
            <select
              value={note.topic_id || ''}
              onChange={e => handleTopicChange(e.target.value)}
              className="bg-transparent border border-gray-200 dark:border-border-dark rounded px-2 py-1 text-sm"
            >
              <option value="">Uncategorized</option>
              {topics.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          {note.status === 'processing' && (
            <span className="inline-flex items-center gap-1.5 text-indigo-600">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Reading note…
            </span>
          )}
          {note.status === 'failed' && (
            <span className="text-red-600 text-xs">Failed: {note.failure_reason || 'unknown error'}</span>
          )}
        </div>
      </div>

      {/* Image carousel */}
      {images.length > 0 && (
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-4 mb-4">
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              Image {activeImage + 1} of {images.length}
              {currentImage?.original_name && <span className="ml-2 text-gray-400">— {currentImage.original_name}</span>}
            </span>
            <div className="flex items-center gap-1">
              {currentImage && (
                <>
                  <button
                    onClick={() => handleDownloadImage(currentImage.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 rounded"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download
                  </button>
                  <button
                    onClick={() => handleDeleteImage(currentImage.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="relative bg-gray-50 dark:bg-surface-dark-tertiary rounded-lg flex items-center justify-center min-h-[300px]">
            {images.length > 1 && (
              <button
                onClick={() => setActiveImage(i => (i - 1 + images.length) % images.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 dark:bg-black/40 hover:bg-white p-2 rounded-full shadow z-10"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {currentImage?.signed_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentImage.signed_url}
                alt={currentImage.original_name || 'Note image'}
                className="max-w-full max-h-[480px] object-contain rounded"
              />
            ) : (
              <div className="text-gray-400 py-12">Image unavailable</div>
            )}
            {images.length > 1 && (
              <button
                onClick={() => setActiveImage(i => (i + 1) % images.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 dark:bg-black/40 hover:bg-white p-2 rounded-full shadow z-10"
                aria-label="Next image"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              const files = Array.from(e.target.files || [])
              if (files.length) handleAddImages(files)
              e.target.value = ''
            }}
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={adding}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-gray-200 dark:border-border-dark text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
              Add more images
            </button>
          </div>
        </div>
      )}

      {/* AI summary */}
      {note.summary && (
        <div className="bg-indigo-50/40 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30 rounded-xl p-5 mb-4">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-indigo-700 dark:text-indigo-300 mb-2">Summary by Wren</h3>
          <pre className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans">{note.summary}</pre>
        </div>
      )}

      {/* Editable body */}
      <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">Note</h3>
          {savingBody ? (
            <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>
          ) : bodyDirty ? (
            <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Save className="w-3 h-3" /> Unsaved</span>
          ) : null}
        </div>
        <textarea
          value={bodyDraft}
          onChange={e => { setBodyDraft(e.target.value); setBodyDirty(true) }}
          placeholder={note.status === 'processing' ? 'Wren is transcribing…' : 'Write your note here…'}
          className="w-full min-h-[240px] bg-transparent text-sm text-gray-800 dark:text-gray-200 focus:outline-none resize-y font-sans"
        />
      </div>

      {/* Extracted actions */}
      {(visibleTodos.length > 0 || visibleCommitments.length > 0) && (
        <div className="bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark p-5 mb-4">
          <h3 className="text-xs uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 mb-3">
            Wren found {visibleTodos.length} todo{visibleTodos.length === 1 ? '' : 's'}
            {visibleCommitments.length > 0 && ` and ${visibleCommitments.length} commitment${visibleCommitments.length === 1 ? '' : 's'}`}
            {' '}in this note
          </h3>
          {visibleTodos.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">Todos</h4>
              <div className="space-y-2">
                {visibleTodos.map(t => (
                  <ActionRow
                    key={`todo-${t.idx}`}
                    title={t.title}
                    onAccept={() => handleAction('todo', t.idx, 'accept')}
                    onDismiss={() => handleAction('todo', t.idx, 'dismiss')}
                  />
                ))}
              </div>
            </div>
          )}
          {visibleCommitments.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">Commitments</h4>
              <div className="space-y-2">
                {visibleCommitments.map(c => (
                  <ActionRow
                    key={`com-${c.idx}`}
                    title={c.title}
                    onAccept={() => handleAction('commitment', c.idx, 'accept')}
                    onDismiss={() => handleAction('commitment', c.idx, 'dismiss')}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionRow({ title, onAccept, onDismiss }: { title: string; onAccept: () => void; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 p-2 border border-gray-100 dark:border-border-dark rounded-md text-sm">
      <span className="flex-1 text-gray-800 dark:text-gray-200">{title}</span>
      <button
        onClick={onAccept}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md"
      >
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Add
      </button>
      <button
        onClick={onDismiss}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-md"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
