'use client'

import { useEffect, useState, useRef } from 'react'
import { ListChecks, Plus, Trash2, ChevronRight, Star, ChevronDown, FileText, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'
import { TODO_CATEGORIES, getCategoryLabel, getCategoryColor } from '@/components/todo-panel'
import type { TodoCategory } from '@/components/todo-panel'

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

export default function TodosPage() {
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
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const subInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchTodos()
  }, [])

  useEffect(() => {
    if (addingSubFor) {
      setTimeout(() => subInputRef.current?.focus(), 50)
    }
  }, [addingSubFor])

  const fetchTodos = async () => {
    try {
      const res = await fetch('/api/todos')
      if (res.ok) {
        const data = await res.json()
        setTodos(data.todos || [])
      }
    } catch {
      toast.error('Failed to load to-dos')
    } finally {
      setLoading(false)
    }
  }

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

  const toggleFilter = (category: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  if (loading) return <LoadingSkeleton />

  // Separate top-level and children
  const topLevel = todos.filter(t => !t.parent_id)
  const childrenOf = (parentId: string) => todos.filter(t => t.parent_id === parentId)

  // Apply category filters
  const hasFilters = activeFilters.size > 0
  const filteredTopLevel = hasFilters
    ? topLevel.filter(t => {
        if (activeFilters.has('starred')) return t.starred
        if (activeFilters.has('uncategorized')) return !t.category
        return t.category !== null && activeFilters.has(t.category)
      })
    : topLevel

  const incomplete = filteredTopLevel.filter(t => !t.completed)
  const completed = filteredTopLevel.filter(t => t.completed)

  // Count how many todos per category (for filter badges)
  const categoryCounts = new Map<string, number>()
  const starredCount = topLevel.filter(t => t.starred && !t.completed).length
  const uncategorizedCount = topLevel.filter(t => !t.category && !t.completed).length
  for (const cat of TODO_CATEGORIES) {
    categoryCounts.set(cat.value, topLevel.filter(t => t.category === cat.value && !t.completed).length)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.025em' }}>
          To-Dos
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Your personal task list. Quick capture, quick complete.
        </p>
      </div>

      {/* Add input */}
      <form
        onSubmit={(e) => { e.preventDefault(); addTodo() }}
        className="space-y-2"
      >
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="What do you need to do?"
            className="flex-1 text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm"
            maxLength={200}
            autoFocus
          />
          <button
            type="submit"
            disabled={!newTitle.trim() || adding}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        {newTitle.trim() && (
          <div className="relative inline-block">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-600 appearance-none bg-white pr-7"
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

      {/* Category filters */}
      {topLevel.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 font-medium">Filter:</span>
          <button
            onClick={() => toggleFilter('starred')}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition font-medium ${
              activeFilters.has('starred')
                ? 'bg-amber-50 border-amber-300 text-amber-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            <Star className="w-3 h-3" fill={activeFilters.has('starred') ? 'currentColor' : 'none'} />
            Starred
            {starredCount > 0 && <span className="text-[10px] opacity-60">{starredCount}</span>}
          </button>
          {TODO_CATEGORIES.map(cat => {
            const count = categoryCounts.get(cat.value) || 0
            const isActive = activeFilters.has(cat.value)
            return (
              <button
                key={cat.value}
                onClick={() => toggleFilter(cat.value)}
                className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition font-medium ${
                  isActive
                    ? `${getCategoryColor(cat.value)} border-transparent`
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {cat.label}
                {count > 0 && <span className="text-[10px] opacity-60">{count}</span>}
              </button>
            )
          })}
          <button
            onClick={() => toggleFilter('uncategorized')}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition font-medium ${
              activeFilters.has('uncategorized')
                ? 'bg-gray-100 border-gray-300 text-gray-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            Uncategorized
            {uncategorizedCount > 0 && <span className="text-[10px] opacity-60">{uncategorizedCount}</span>}
          </button>
          {hasFilters && (
            <button
              onClick={() => setActiveFilters(new Set())}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 text-gray-400 hover:text-gray-600 transition"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {todos.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <ListChecks className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700" style={{ letterSpacing: '-0.025em' }}>
            No to-dos yet
          </h3>
          <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
            Add tasks above or use the &quot;Add to To-Do&quot; button from briefings, commitments, or any page.
          </p>
        </div>
      )}

      {/* Filtered empty state */}
      {todos.length > 0 && hasFilters && filteredTopLevel.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">No to-dos match the selected filters.</p>
          <button
            onClick={() => setActiveFilters(new Set())}
            className="text-sm text-emerald-600 hover:text-emerald-700 mt-2 font-medium"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Incomplete */}
      {incomplete.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">
              Open ({incomplete.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {incomplete.map(todo => {
              const children = childrenOf(todo.id)
              const isExpanded = expanded.has(todo.id)
              const hasChildren = children.length > 0

              return (
                <div key={todo.id}>
                  {/* Parent row */}
                  <div className="group flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition">
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(todo.id)}
                      className={`w-4 h-4 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-transform ${isExpanded ? 'rotate-90' : ''} ${hasChildren ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => toggleTodo(todo.id, todo.completed)}
                      className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-emerald-400 flex-shrink-0 flex items-center justify-center transition"
                    />
                    <span className="flex-1 text-sm text-gray-800">{todo.title}</span>
                    {todo.category && (
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium ${getCategoryColor(todo.category)}`}>
                        {getCategoryLabel(todo.category)}
                      </span>
                    )}
                    {todo.notes && (
                      <FileText className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    )}
                    {hasChildren && (
                      <span className="text-xs text-gray-400">
                        {children.filter(c => c.completed).length}/{children.length}
                      </span>
                    )}
                    {todo.source_type && todo.source_type !== 'manual' && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        {todo.source_type}
                      </span>
                    )}
                    <button
                      onClick={() => toggleStar(todo.id, todo.starred)}
                      className={`p-1 flex-shrink-0 transition ${
                        todo.starred
                          ? 'text-amber-400 hover:text-amber-500'
                          : 'text-gray-300 hover:text-amber-400'
                      }`}
                      title={todo.starred ? 'Unstar' : 'Star'}
                    >
                      <Star className="w-4 h-4" fill={todo.starred ? 'currentColor' : 'none'} />
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
                      className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition"
                      title="Notes"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setAddingSubFor(addingSubFor === todo.id ? null : todo.id); setSubTitle(''); setExpanded(prev => new Set(prev).add(todo.id)) }}
                      className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-emerald-600 transition"
                      title="Add sub-item"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Notes editor */}
                  {notesOpen === todo.id && (
                    <div className="px-6 pb-3 pt-1 bg-gray-50/50 border-t border-gray-100">
                      <textarea
                        value={editingNotes}
                        onChange={(e) => setEditingNotes(e.target.value)}
                        placeholder="Add notes..."
                        className="w-full text-sm border border-gray-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={() => setNotesOpen(null)}
                          className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveNotes(todo.id)}
                          className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Show saved notes inline (read-only) */}
                  {notesOpen !== todo.id && todo.notes && (
                    <div
                      className="px-6 pl-16 pb-2 cursor-pointer"
                      onClick={() => { setNotesOpen(todo.id); setEditingNotes(todo.notes || '') }}
                    >
                      <p className="text-xs text-gray-400 line-clamp-2 whitespace-pre-wrap">{todo.notes}</p>
                    </div>
                  )}

                  {/* Children */}
                  {isExpanded && children.length > 0 && (
                    <div className="border-t border-gray-50">
                      {children.map(child => (
                        <div key={child.id} className="group flex items-center gap-3 pl-16 pr-6 py-2.5 hover:bg-gray-50 transition">
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
                          <span className={`flex-1 text-sm ${child.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {child.title}
                          </span>
                          <button
                            onClick={() => deleteTodo(child.id)}
                            className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline add sub-item */}
                  {addingSubFor === todo.id && (
                    <form
                      onSubmit={(e) => { e.preventDefault(); addTodo(todo.id) }}
                      className="flex items-center gap-2 pl-16 pr-6 py-2.5 bg-gray-50 border-t border-gray-100"
                    >
                      <input
                        ref={subInputRef}
                        type="text"
                        value={subTitle}
                        onChange={(e) => setSubTitle(e.target.value)}
                        placeholder="Add a sub-item..."
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        maxLength={200}
                        onKeyDown={(e) => { if (e.key === 'Escape') setAddingSubFor(null) }}
                      />
                      <button
                        type="submit"
                        disabled={!subTitle.trim() || adding}
                        className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium disabled:opacity-40"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingSubFor(null)}
                        className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-700 transition"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-400">
              Completed ({completed.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {completed.map(todo => (
              <div key={todo.id} className="group flex items-center gap-4 px-6 py-3 hover:bg-gray-50 transition">
                <button
                  onClick={() => toggleTodo(todo.id, todo.completed)}
                  className="w-5 h-5 rounded-full border-2 bg-emerald-500 border-emerald-500 flex-shrink-0 flex items-center justify-center transition"
                >
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <span className="flex-1 text-sm text-gray-400 line-through">{todo.title}</span>
                {todo.category && (
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 font-medium opacity-50 ${getCategoryColor(todo.category)}`}>
                    {getCategoryLabel(todo.category)}
                  </span>
                )}
                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
