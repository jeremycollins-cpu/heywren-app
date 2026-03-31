'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Plus, Trash2, ListChecks, ChevronRight, Star, ChevronDown, FileText } from 'lucide-react'
import { useTodo } from '@/lib/contexts/todo-context'
import toast from 'react-hot-toast'

export const TODO_CATEGORIES = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'task', label: 'Task' },
  { value: 'idea', label: 'Idea' },
  { value: 'reminder', label: 'Reminder' },
] as const

export type TodoCategory = typeof TODO_CATEGORIES[number]['value']

export function getCategoryLabel(value: string | null): string | null {
  if (!value) return null
  return TODO_CATEGORIES.find(c => c.value === value)?.label ?? value
}

export function getCategoryColor(value: string | null): string {
  switch (value) {
    case 'follow_up': return 'bg-blue-100 text-blue-700'
    case 'task': return 'bg-purple-100 text-purple-700'
    case 'idea': return 'bg-amber-100 text-amber-700'
    case 'reminder': return 'bg-rose-100 text-rose-700'
    default: return 'bg-gray-100 text-gray-600'
  }
}

interface Todo {
  id: string
  title: string
  completed: boolean
  completed_at: string | null
  source_type: string | null
  parent_id: string | null
  category: string | null
  notes: string | null
  starred: boolean
  created_at: string
}

interface TodoPanelProps {
  open: boolean
  onClose: () => void
}

export default function TodoPanel({ open, onClose }: TodoPanelProps) {
  const { pendingTitle, clearPendingTitle } = useTodo()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newCategory, setNewCategory] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [subTitle, setSubTitle] = useState('')
  const [notesOpen, setNotesOpen] = useState<string | null>(null)
  const [editingNotes, setEditingNotes] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const subInputRef = useRef<HTMLInputElement>(null)

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch('/api/todos')
      if (res.ok) {
        const data = await res.json()
        setTodos(data.todos || [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchTodos()
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open, fetchTodos])

  useEffect(() => {
    if (open && pendingTitle) {
      setNewTitle(pendingTitle)
      clearPendingTitle()
    }
  }, [open, pendingTitle, clearPendingTitle])

  useEffect(() => {
    if (addingSubFor) {
      setTimeout(() => subInputRef.current?.focus(), 50)
    }
  }, [addingSubFor])

  const addTodo = async (parentId?: string) => {
    const title = parentId ? subTitle : newTitle
    if (!title.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          parent_id: parentId || undefined,
          category: !parentId && newCategory ? newCategory : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setTodos(prev => [data.todo, ...prev])
        if (parentId) {
          setSubTitle('')
          setExpanded(prev => new Set(prev).add(parentId))
        } else {
          setNewTitle('')
          setNewCategory('')
          inputRef.current?.focus()
        }
      }
    } catch {
      toast.error('Failed to add to-do')
    } finally {
      setAdding(false)
    }
  }

  const toggleTodo = async (id: string, completed: boolean) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, completed: !completed, completed_at: !completed ? new Date().toISOString() : null } : t
    ))

    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, completed: !completed }),
      })
      if (!res.ok) {
        setTodos(prev => prev.map(t =>
          t.id === id ? { ...t, completed, completed_at: completed ? t.completed_at : null } : t
        ))
      }
    } catch {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, completed, completed_at: completed ? t.completed_at : null } : t
      ))
    }
  }

  const toggleStar = async (id: string, starred: boolean) => {
    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, starred: !starred } : t
    ))

    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, starred: !starred }),
      })
      if (!res.ok) {
        setTodos(prev => prev.map(t =>
          t.id === id ? { ...t, starred } : t
        ))
      }
    } catch {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, starred } : t
      ))
    }
  }

  const saveNotes = async (id: string) => {
    const todo = todos.find(t => t.id === id)
    if (!todo) return

    setTodos(prev => prev.map(t =>
      t.id === id ? { ...t, notes: editingNotes || null } : t
    ))
    setNotesOpen(null)

    try {
      await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes: editingNotes || null }),
      })
    } catch {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, notes: todo.notes } : t
      ))
    }
  }

  const deleteTodo = async (id: string) => {
    const prev = todos
    setTodos(t => t.filter(todo => todo.id !== id && todo.parent_id !== id))

    try {
      const res = await fetch(`/api/todos?id=${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setTodos(prev)
        toast.error('Failed to delete')
      }
    } catch {
      setTodos(prev)
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const topLevel = todos.filter(t => !t.parent_id)
  const childrenOf = (parentId: string) => todos.filter(t => t.parent_id === parentId)
  const incomplete = topLevel.filter(t => !t.completed)
  const completed = topLevel.filter(t => t.completed)

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl transition-transform duration-300 z-50 flex flex-col ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
              <ListChecks className="w-5 h-5 text-white" />
            </div>
            <h2 className="font-semibold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
              To-Dos
            </h2>
            {incomplete.length > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                {incomplete.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Add input */}
        <div className="px-6 py-4 border-b border-gray-100">
          <form
            onSubmit={(e) => { e.preventDefault(); addTodo() }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add a to-do..."
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                maxLength={200}
              />
              <button
                type="submit"
                disabled={!newTitle.trim() || adding}
                className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            {newTitle.trim() && (
              <div className="relative">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-600 appearance-none bg-white pr-7"
                >
                  <option value="">No category</option>
                  {TODO_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
          </form>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="space-y-3 px-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : todos.length === 0 ? (
            <div className="text-center py-12">
              <ListChecks className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No to-dos yet</p>
              <p className="text-xs text-gray-400 mt-1">Add one above to get started</p>
            </div>
          ) : (
            <>
              {/* Incomplete */}
              {incomplete.length > 0 && (
                <div className="space-y-0.5">
                  {incomplete.map(todo => {
                    const children = childrenOf(todo.id)
                    const isExpanded = expanded.has(todo.id)
                    const hasChildren = children.length > 0

                    return (
                      <div key={todo.id}>
                        {/* Parent item */}
                        <div className="group flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 transition">
                          <button
                            onClick={() => toggleExpand(todo.id)}
                            className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''} ${hasChildren ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleTodo(todo.id, todo.completed)}
                            className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-emerald-400 flex-shrink-0 flex items-center justify-center transition"
                          />
                          <span className="flex-1 text-sm text-gray-800 truncate">{todo.title}</span>
                          {todo.category && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium ${getCategoryColor(todo.category)}`}>
                              {getCategoryLabel(todo.category)}
                            </span>
                          )}
                          {todo.notes && (
                            <FileText className="w-3 h-3 text-gray-300 flex-shrink-0" />
                          )}
                          {hasChildren && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              {children.filter(c => c.completed).length}/{children.length}
                            </span>
                          )}
                          <button
                            onClick={() => toggleStar(todo.id, todo.starred)}
                            className={`p-0.5 flex-shrink-0 transition ${
                              todo.starred
                                ? 'text-amber-400 hover:text-amber-500'
                                : 'text-gray-300 hover:text-amber-400'
                            }`}
                            title={todo.starred ? 'Unstar' : 'Star'}
                          >
                            <Star className="w-3.5 h-3.5" fill={todo.starred ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            onClick={() => {
                              if (notesOpen === todo.id) {
                                saveNotes(todo.id)
                              } else {
                                setNotesOpen(todo.id)
                                setEditingNotes(todo.notes || '')
                              }
                            }}
                            className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition flex-shrink-0"
                            title="Notes"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { setAddingSubFor(addingSubFor === todo.id ? null : todo.id); setSubTitle(''); setExpanded(prev => new Set(prev).add(todo.id)) }}
                            className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-emerald-600 transition flex-shrink-0"
                            title="Add sub-item"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteTodo(todo.id)}
                            className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Notes editor */}
                        {notesOpen === todo.id && (
                          <div className="ml-6 mr-2 mb-1">
                            <textarea
                              value={editingNotes}
                              onChange={(e) => setEditingNotes(e.target.value)}
                              placeholder="Add notes..."
                              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                              rows={3}
                              autoFocus
                            />
                            <div className="flex justify-end gap-1 mt-1">
                              <button
                                onClick={() => setNotesOpen(null)}
                                className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => saveNotes(todo.id)}
                                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Children */}
                        {isExpanded && children.length > 0 && (
                          <div className="ml-6 space-y-0.5">
                            {children.map(child => (
                              <div key={child.id} className="group flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition">
                                <button
                                  onClick={() => toggleTodo(child.id, child.completed)}
                                  className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition ${
                                    child.completed
                                      ? 'bg-emerald-500 border-emerald-500'
                                      : 'border-gray-300 hover:border-emerald-400'
                                  }`}
                                >
                                  {child.completed && (
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                                <span className={`flex-1 text-sm truncate ${child.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                  {child.title}
                                </span>
                                <button
                                  onClick={() => deleteTodo(child.id)}
                                  className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition flex-shrink-0"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline add sub-item */}
                        {addingSubFor === todo.id && (
                          <form
                            onSubmit={(e) => { e.preventDefault(); addTodo(todo.id) }}
                            className="flex items-center gap-2 ml-6 px-2 py-1.5"
                          >
                            <input
                              ref={subInputRef}
                              type="text"
                              value={subTitle}
                              onChange={(e) => setSubTitle(e.target.value)}
                              placeholder="Add sub-item..."
                              className="flex-1 text-sm border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                              maxLength={200}
                              onKeyDown={(e) => { if (e.key === 'Escape') setAddingSubFor(null) }}
                            />
                            <button
                              type="submit"
                              disabled={!subTitle.trim() || adding}
                              className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition font-medium disabled:opacity-40"
                            >
                              Add
                            </button>
                          </form>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Completed */}
              {completed.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-2">
                    Completed ({completed.length})
                  </p>
                  <div className="space-y-0.5">
                    {completed.map(todo => (
                      <div key={todo.id} className="group flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition">
                        <button
                          onClick={() => toggleTodo(todo.id, todo.completed)}
                          className="w-5 h-5 rounded-full border-2 bg-emerald-500 border-emerald-500 flex-shrink-0 flex items-center justify-center transition"
                        >
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <span className="flex-1 text-sm text-gray-400 line-through truncate">{todo.title}</span>
                        <button
                          onClick={() => deleteTodo(todo.id)}
                          className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// Export a hook for adding todos from anywhere
export function useAddTodo() {
  const addTodo = async (title: string, sourceType?: string, sourceId?: string) => {
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, source_type: sourceType, source_id: sourceId }),
      })
      if (res.ok) {
        toast.success('Added to To-Dos')
        return true
      }
      toast.error('Failed to add to-do')
      return false
    } catch {
      toast.error('Failed to add to-do')
      return false
    }
  }

  return { addTodo }
}
