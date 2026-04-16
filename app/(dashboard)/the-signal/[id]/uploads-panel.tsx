'use client'

// File upload panel. Supports drag-and-drop + click-to-browse; tracks
// extraction status per file and lets the user remove uploads before
// regenerating.

import { useRef, useState } from 'react'
import {
  Upload, FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon,
  Loader2, Trash2, CheckCircle2, AlertTriangle, RotateCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { BriefingUpload } from '@/lib/monthly-briefing/types'

interface Props {
  briefingId: string
  uploads: BriefingUpload[]
  canRegenerate: boolean
  onAdded: (upload: BriefingUpload) => void
  onRemoved: (uploadId: string) => void
  onRegenerate: () => void
  regenerating: boolean
}

const ACCEPTED = '.pdf,.pptx,.docx,.xlsx,.xls,.csv,.txt,.md,.png,.jpg,.jpeg'

function KindIcon({ kind }: { kind: string }) {
  const cls = 'w-4 h-4 flex-shrink-0'
  if (kind === 'xlsx' || kind === 'csv') return <FileSpreadsheet className={`${cls} text-emerald-600`} aria-hidden="true" />
  if (kind === 'image') return <ImageIcon className={`${cls} text-pink-600`} aria-hidden="true" />
  if (kind === 'pdf' || kind === 'pptx' || kind === 'docx') return <FileText className={`${cls} text-red-600`} aria-hidden="true" />
  return <FileIcon className={`${cls} text-gray-500`} aria-hidden="true" />
}

function StatusBadge({ upload }: { upload: BriefingUpload }) {
  switch (upload.extraction_status) {
    case 'ready':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          Ready
        </span>
      )
    case 'pending':
    case 'extracting':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-700">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          Reading
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-700" title={upload.extraction_error || ''}>
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          Failed
        </span>
      )
    case 'skipped':
      return <span className="text-xs text-gray-500">Skipped</span>
    default:
      return null
  }
}

export default function UploadsPanel({
  briefingId, uploads, canRegenerate, onAdded, onRemoved, onRegenerate, regenerating,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    try {
      for (const file of list) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/api/the-signal/${briefingId}/upload`, {
          method: 'POST',
          body: form,
        })
        const json = await res.json()
        if (!res.ok) {
          toast.error(json.error || `Upload failed: ${file.name}`)
          continue
        }
        if (json.upload) onAdded(json.upload)
      }
    } finally {
      setUploading(false)
    }
  }

  const remove = async (uploadId: string) => {
    try {
      const res = await fetch(`/api/the-signal/${briefingId}/upload?uploadId=${uploadId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onRemoved(uploadId)
        toast.success('Upload removed.')
      }
    } catch { /* ignore */ }
  }

  const pendingCount = uploads.filter(u =>
    u.extraction_status === 'pending' || u.extraction_status === 'failed'
  ).length

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Context files</h3>
        {uploads.length > 0 && (
          <span className="text-xs text-gray-500">{uploads.length} file{uploads.length === 1 ? '' : 's'}</span>
        )}
      </div>

      {/* Dropzone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition ${
          dragOver
            ? 'border-indigo-400 bg-indigo-50/50'
            : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
        />
        {uploading ? (
          <div className="inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Uploading…
          </div>
        ) : (
          <>
            <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1.5" aria-hidden="true" />
            <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">Drop decks, spreadsheets, or docs</p>
            <p className="text-xs text-gray-500 mt-0.5">PDF, PPTX, DOCX, XLSX, CSV, TXT, PNG, JPG · up to 25 MB</p>
          </>
        )}
      </div>

      {/* List */}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {uploads.map(u => (
            <li
              key={u.id}
              className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2"
            >
              <KindIcon kind={u.file_kind} />
              <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{u.file_name}</span>
              <StatusBadge upload={u} />
              <button
                onClick={() => remove(u.id)}
                className="p-1 text-gray-400 hover:text-red-600"
                title="Remove upload"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Regenerate CTA when there's pending work */}
      {pendingCount > 0 && canRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 py-2 text-sm font-semibold text-white rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60"
        >
          {regenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
          Regenerate with {pendingCount} new file{pendingCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}
