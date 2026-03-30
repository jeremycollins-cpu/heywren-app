'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Plus, Trash2, ListChecks } from 'lucide-react'
import { useTodo } from '@/lib/contexts/todo-context'
import toast from 'react-hot-toast'

interface Todo {
  id: string
  title: string
  completed: boolean
  completed_at: string | null
  source_type: string | null
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
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Pre-fill title when opened from another page
  useEffect(() => {
    if (open && pendingTitle) {
      setNewTitle(pendingTitle)
      clearPendingTitle()
    }
  }, [open, pendingTitle, clearPendingTitle])

  const addTodo = async () => {
    if (!newTitle.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setTodos(prev => [data.todo, ...prev])
        setNewTitle('')
        inputRef.current?.focus()
      }
    } catch {
      toast.error('Failed to add to-do')
    } finally {
      setAdding(false)
    }
  }

  const toggleTodo = async (id: string, completed: boolean) => {
    // Optimistic update
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
        // Revert on failure
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
    setTodos(t => t.filter(todo => todo.id !== id))

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

  const incomplete = todos.filter(t => !t.completed)
  const completed = todos.filter(t => t.completed)

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
            className="flex items-center gap-2"
          >
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
          </form>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
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
                <div className="space-y-1">
                  {incomplete.map(todo => (
                    <TodoItem
                      key={todo.id}
                      todo={todo}
                      onToggle={toggleTodo}
                      onDelete={deleteTodo}
                    />
                  ))}
                </div>
              )}

              {/* Completed */}
              {completed.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                    Completed ({completed.length})
                  </p>
                  <div className="space-y-1">
                    {completed.map(todo => (
                      <TodoItem
                        key={todo.id}
                        todo={todo}
                        onToggle={toggleTodo}
                        onDelete={deleteTodo}
                      />
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

function TodoItem({
  todo,
  onToggle,
  onDelete,
}: {
  todo: Todo
  onToggle: (id: string, completed: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="group flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition">
      <button
        onClick={() => onToggle(todo.id, todo.completed)}
        className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition ${
          todo.completed
            ? 'bg-emerald-500 border-emerald-500'
            : 'border-gray-300 hover:border-emerald-400'
        }`}
      >
        {todo.completed && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
      <span
        className={`flex-1 text-sm ${
          todo.completed ? 'text-gray-400 line-through' : 'text-gray-800'
        }`}
      >
        {todo.title}
      </span>
      <button
        onClick={() => onDelete(todo.id)}
        className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
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
