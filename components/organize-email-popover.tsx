'use client'

import { useState, useEffect, useRef } from 'react'
import {
  FolderInput, Plus, Check, Loader2, ChevronDown, X, FolderPlus
} from 'lucide-react'
import toast from 'react-hot-toast'

interface EmailFolder {
  id: string
  folder_id: string
  display_name: string
  is_custom: boolean
  message_count: number
}

interface OrganizeEmailPopoverProps {
  fromEmail: string
  fromName?: string | null
  fromDomain: string
  subject?: string | null
  emailIds: string[]               // Graph message IDs to move now
  existingMatchCount?: number      // "12 other emails from this sender"
  onComplete?: () => void
}

type MatchType = 'from_email' | 'from_domain' | 'subject_contains'

export default function OrganizeEmailPopover({
  fromEmail,
  fromName,
  fromDomain,
  subject,
  emailIds,
  existingMatchCount = 0,
  onComplete,
}: OrganizeEmailPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [folders, setFolders] = useState<EmailFolder[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<EmailFolder | null>(null)
  const [showFolderDropdown, setShowFolderDropdown] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [matchType, setMatchType] = useState<MatchType>('from_email')
  const [createRule, setCreateRule] = useState(true)
  const [applyToExisting, setApplyToExisting] = useState(existingMatchCount > 0)
  const [markAsRead, setMarkAsRead] = useState(false)
  const [organizing, setOrganizing] = useState(false)
  const [done, setDone] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Close dropdown on click outside
  useEffect(() => {
    if (!showFolderDropdown) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowFolderDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showFolderDropdown])

  const fetchFolders = async () => {
    setLoadingFolders(true)
    try {
      const res = await fetch('/api/email-folders')
      if (!res.ok) throw new Error('Failed to load folders')
      const data = await res.json()
      setFolders(data.folders || [])
    } catch {
      toast.error('Failed to load folders')
    } finally {
      setLoadingFolders(false)
    }
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(true)
    setDone(false)
    fetchFolders()
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    setCreatingFolder(true)
    try {
      const res = await fetch('/api/email-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newFolderName.trim() }),
      })
      if (!res.ok) throw new Error('Failed to create folder')
      const data = await res.json()
      const newFolder: EmailFolder = {
        id: data.folder?.folder_id || data.folder?.id,
        folder_id: data.folder?.folder_id || data.folder?.id,
        display_name: newFolderName.trim(),
        is_custom: true,
        message_count: 0,
      }
      setFolders(prev => [...prev, newFolder].sort((a, b) => a.display_name.localeCompare(b.display_name)))
      setSelectedFolder(newFolder)
      setNewFolderName('')
      setShowNewFolderInput(false)
      toast.success(`Folder "${newFolder.display_name}" created`)
    } catch {
      toast.error('Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  const matchValueForType = (type: MatchType): string => {
    switch (type) {
      case 'from_email': return fromEmail
      case 'from_domain': return fromDomain
      case 'subject_contains': return subject?.replace(/^(re:\s*|fwd?:\s*)+/i, '').trim() || ''
    }
  }

  const handleOrganize = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!selectedFolder) {
      toast.error('Please select a folder')
      return
    }

    setOrganizing(true)
    try {
      const res = await fetch('/api/email-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchType,
          matchValue: matchValueForType(matchType),
          targetFolderId: selectedFolder.folder_id,
          targetFolderName: selectedFolder.display_name,
          markAsRead,
          applyToExisting: createRule && applyToExisting,
          sourceEmailIds: emailIds,
        }),
      })

      if (!res.ok) throw new Error('Failed to organize')
      const data = await res.json()

      setDone(true)
      const movedText = data.movedCount > 0 ? ` ${data.movedCount} email${data.movedCount !== 1 ? 's' : ''} moved.` : ''
      const ruleText = data.syncStatus === 'synced' ? ' Rule created.' : ''
      toast.success(`Organized!${movedText}${ruleText}`)

      setTimeout(() => {
        setIsOpen(false)
        setDone(false)
        onComplete?.()
      }, 1500)
    } catch {
      toast.error('Failed to organize emails')
    } finally {
      setOrganizing(false)
    }
  }

  // Popover button
  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 px-4 py-2 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition text-sm font-medium"
        title="Organize emails from this sender into a folder"
      >
        <FolderInput aria-hidden="true" className="w-4 h-4" />
        Organize
      </button>
    )
  }

  // Done state
  if (done) {
    return (
      <div ref={popoverRef} className="relative z-50">
        <div className="absolute right-0 top-0 w-80 bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark shadow-xl p-5">
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">Organized!</p>
          </div>
        </div>
      </div>
    )
  }

  // Custom folders first, then system folders
  const customFolders = folders.filter(f => f.is_custom)
  const systemFolders = folders.filter(f => !f.is_custom)

  return (
    <div ref={popoverRef} className="relative z-50" onClick={e => e.stopPropagation()}>
      <div className="absolute right-0 top-0 w-96 bg-white dark:bg-surface-dark-secondary rounded-xl border border-gray-200 dark:border-border-dark shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Organize emails from
          </h3>
          <button
            onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-2">
          <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
            <span className="font-medium text-gray-800 dark:text-gray-200">{fromName || fromEmail}</span>
            {fromName && <span className="text-xs ml-1">({fromEmail})</span>}
          </p>
        </div>

        <div className="px-5 pb-4 space-y-4">
          {/* Match type selector */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Match</label>
            <div className="flex gap-1.5">
              <button
                onClick={() => setMatchType('from_email')}
                className={`px-2.5 py-1.5 text-xs rounded-lg transition font-medium ${
                  matchType === 'from_email'
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {fromEmail}
              </button>
              <button
                onClick={() => setMatchType('from_domain')}
                className={`px-2.5 py-1.5 text-xs rounded-lg transition font-medium ${
                  matchType === 'from_domain'
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                @{fromDomain}
              </button>
              {subject && (
                <button
                  onClick={() => setMatchType('subject_contains')}
                  className={`px-2.5 py-1.5 text-xs rounded-lg transition font-medium truncate max-w-[120px] ${
                    matchType === 'subject_contains'
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  title={`Subject: ${subject}`}
                >
                  Subject
                </button>
              )}
            </div>
          </div>

          {/* Folder picker */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Move to folder</label>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowFolderDropdown(!showFolderDropdown)}
                disabled={loadingFolders}
                className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
              >
                {loadingFolders ? (
                  <span className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading folders...
                  </span>
                ) : selectedFolder ? (
                  <span className="text-gray-900 dark:text-gray-100 font-medium">{selectedFolder.display_name}</span>
                ) : (
                  <span className="text-gray-400">Select a folder...</span>
                )}
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </button>

              {showFolderDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-white dark:bg-surface-dark-secondary border border-gray-200 dark:border-border-dark rounded-lg shadow-lg z-10">
                  {/* Custom folders */}
                  {customFolders.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Your folders</div>
                      {customFolders.map(folder => (
                        <button
                          key={folder.folder_id}
                          onClick={() => { setSelectedFolder(folder); setShowFolderDropdown(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition flex items-center justify-between"
                        >
                          <span className="text-gray-800 dark:text-gray-200">{folder.display_name}</span>
                          <span className="text-xs text-gray-400">{folder.message_count}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* System folders */}
                  {systemFolders.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-semibold border-t border-gray-100 dark:border-gray-800">
                        System folders
                      </div>
                      {systemFolders.map(folder => (
                        <button
                          key={folder.folder_id}
                          onClick={() => { setSelectedFolder(folder); setShowFolderDropdown(false) }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition flex items-center justify-between"
                        >
                          <span className="text-gray-800 dark:text-gray-200">{folder.display_name}</span>
                          <span className="text-xs text-gray-400">{folder.message_count}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Create new folder */}
                  <div className="border-t border-gray-100 dark:border-gray-800">
                    {showNewFolderInput ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input
                          type="text"
                          value={newFolderName}
                          onChange={e => setNewFolderName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                          placeholder="Folder name..."
                          className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          autoFocus
                        />
                        <button
                          onClick={handleCreateFolder}
                          disabled={creatingFolder || !newFolderName.trim()}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded disabled:opacity-40"
                        >
                          {creatingFolder ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNewFolderInput(true)}
                        className="w-full text-left px-3 py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition flex items-center gap-2 font-medium"
                      >
                        <FolderPlus className="w-4 h-4" />
                        Create new folder
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={createRule}
                onChange={e => setCreateRule(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">Always do this for future emails</span>
            </label>

            {existingMatchCount > 0 && createRule && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyToExisting}
                  onChange={e => setApplyToExisting(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  Apply to {existingMatchCount} existing email{existingMatchCount !== 1 ? 's' : ''} in inbox
                </span>
              </label>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={markAsRead}
                onChange={e => setMarkAsRead(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-gray-700 dark:text-gray-300">Mark as read</span>
            </label>
          </div>

          {/* Action button */}
          <button
            onClick={handleOrganize}
            disabled={organizing || !selectedFolder}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {organizing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Organizing...
              </>
            ) : (
              <>
                <FolderInput className="w-4 h-4" />
                Organize
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
