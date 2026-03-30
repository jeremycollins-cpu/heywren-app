'use client'

import { useEffect, useState, useRef } from 'react'
import { ListChecks, Plus, Trash2, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { LoadingSkeleton } from '@/components/ui/loading-skeleton'

interface Todo {
  id: string
  title: string
  completed: boolean
  completed_at: string | null
  source_type: string | null
  parent_id: string | null
  created_at: string
}

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [subTitle, setSubTitle] = useState('')
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
        body: JSON.stringify({ title: title.trim(), parent_id: parentId || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        setTodos(prev => [data.todo, ...prev])
        if (parentId) {
          setSubTitle('')
          setExpanded(prev => new Set(prev).add(parentId))
        } else {
          setNewTitle('')
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

  const deleteTodo = async (id: string) => {
    const prev = todos
    // Remove the todo and any children
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

  if (loading) return <LoadingSkeleton />

  // Separate top-level and children
  const topLevel = todos.filter(t => !t.parent_id)
  const childrenOf = (parentId: string) => todos.filter(t => t.parent_id === parentId)

  const incomplete = topLevel.filter(t => !t.completed)
  const completed = topLevel.filter(t => t.completed)

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
        className="flex items-center gap-3"
      >
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
      </form>

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
