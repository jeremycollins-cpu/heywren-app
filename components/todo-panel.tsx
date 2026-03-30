'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Plus, Trash2, ListChecks, ChevronRight, Users } from 'lucide-react'
import { useTodo } from '@/lib/contexts/todo-context'
import toast from 'react-hot-toast'

interface Todo {
  id: string
  title: string
  completed: boolean
  completed_at: string | null
  source_type: string | null
  parent_id: string | null
  user_id: string
  assigned_to: string | null
  created_at: string
}

interface TeamMember {
  id: string
  name: string
  email: string
}

interface ProfileMap {
  [userId: string]: { display_name: string; email: string }
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ['bg-indigo-500', 'bg-green-500', 'bg-orange-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500']
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length] }

interface TodoPanelProps {
  open: boolean
  onClose: () => void
}

export default function TodoPanel({ open, onClose }: TodoPanelProps) {
  const { pendingTitle, clearPendingTitle } = useTodo()
  const [todos, setTodos] = useState<Todo[]>([])
  const [profiles, setProfiles] = useState<ProfileMap>({})
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newAssignee, setNewAssignee] = useState<string | null>(null)
  const [showAssigneePicker, setShowAssigneePicker] = useState(false)
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [subTitle, setSubTitle] = useState('')
  const [assigningFor, setAssigningFor] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const subInputRef = useRef<HTMLInputElement>(null)

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch('/api/todos')
      if (res.ok) {
        const data = await res.json()
        setTodos(data.todos || [])
        if (data.profiles) setProfiles(data.profiles)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTeamMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/todos/team-members')
      if (res.ok) {
        const data = await res.json()
        setTeamMembers(data.members || [])
      }
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchTodos()
      fetchTeamMembers()
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open, fetchTodos, fetchTeamMembers])

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
          assigned_to: parentId ? undefined : newAssignee,
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
          setNewAssignee(null)
          setShowAssigneePicker(false)
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

  const assignTodo = async (todoId: string, assigneeId: string | null) => {
    setTodos(prev => prev.map(t =>
      t.id === todoId ? { ...t, assigned_to: assigneeId } : t
    ))
    setAssigningFor(null)

    try {
      const res = await fetch('/api/todos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: todoId, assigned_to: assigneeId }),
      })
      if (res.ok && assigneeId) fetchTodos()
    } catch {
      toast.error('Failed to assign')
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

  const getProfileName = useCallback((userId: string | null) => {
    if (!userId || !profiles[userId]) return null
    return profiles[userId].display_name || profiles[userId].email?.split('@')[0]
  }, [profiles])

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
            {/* Assignee row */}
            {teamMembers.length > 0 && newTitle.trim() && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {newAssignee ? (
                  <button
                    type="button"
                    onClick={() => setNewAssignee(null)}
                    className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full hover:bg-indigo-100 transition"
                  >
                    <span className={`w-3.5 h-3.5 ${avatarColor(teamMembers.find(m => m.id === newAssignee)?.name || '')} rounded-full flex items-center justify-center text-white text-[7px] font-bold`}>
                      {getInitials(teamMembers.find(m => m.id === newAssignee)?.name || '')}
                    </span>
                    {teamMembers.find(m => m.id === newAssignee)?.name}
                    <X className="w-2.5 h-2.5" />
                  </button>
                ) : showAssigneePicker ? (
                  <>
                    {teamMembers.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setNewAssignee(m.id); setShowAssigneePicker(false) }}
                        className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-indigo-700 hover:bg-indigo-50 px-1.5 py-0.5 rounded-full transition"
                      >
                        <span className={`w-3.5 h-3.5 ${avatarColor(m.name)} rounded-full flex items-center justify-center text-white text-[7px] font-bold`}>
                          {getInitials(m.name)}
                        </span>
                        {m.name.split(' ')[0]}
                      </button>
                    ))}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAssigneePicker(true)}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition"
                  >
                    <Users className="w-3 h-3" />
                    Assign
                  </button>
                )}
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
                    const assigneeName = getProfileName(todo.assigned_to)

                    return (
                      <div key={todo.id}>
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
                          {assigneeName && (
                            <span
                              className={`w-5 h-5 ${avatarColor(assigneeName)} rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0 cursor-pointer`}
                              title={assigneeName}
                              onClick={() => setAssigningFor(assigningFor === todo.id ? null : todo.id)}
                            >
                              {getInitials(assigneeName)}
                            </span>
                          )}
                          {hasChildren && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              {children.filter(c => c.completed).length}/{children.length}
                            </span>
                          )}
                          {!assigneeName && teamMembers.length > 0 && (
                            <button
                              onClick={() => setAssigningFor(assigningFor === todo.id ? null : todo.id)}
                              className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 transition flex-shrink-0"
                              title="Assign"
                            >
                              <Users className="w-3.5 h-3.5" />
                            </button>
                          )}
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

                        {/* Assignee picker */}
                        {assigningFor === todo.id && (
                          <div className="ml-6 px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
                            {todo.assigned_to && (
                              <button onClick={() => assignTodo(todo.id, null)} className="text-[10px] text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded-full hover:bg-red-50 transition">
                                Remove
                              </button>
                            )}
                            {teamMembers.map(m => (
                              <button
                                key={m.id}
                                onClick={() => assignTodo(todo.id, m.id)}
                                className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full transition ${
                                  todo.assigned_to === m.id ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-700'
                                }`}
                              >
                                <span className={`w-3.5 h-3.5 ${avatarColor(m.name)} rounded-full flex items-center justify-center text-white text-[7px] font-bold`}>
                                  {getInitials(m.name)}
                                </span>
                                {m.name.split(' ')[0]}
                              </button>
                            ))}
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
                                    child.completed ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 hover:border-emerald-400'
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
                    {completed.map(todo => {
                      const assigneeName = getProfileName(todo.assigned_to)
                      return (
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
                          {assigneeName && (
                            <span
                              className={`w-4 h-4 ${avatarColor(assigneeName)} rounded-full flex items-center justify-center text-white text-[7px] font-bold flex-shrink-0 opacity-50`}
                              title={assigneeName}
                            >
                              {getInitials(assigneeName)}
                            </span>
                          )}
                          <button
                            onClick={() => deleteTodo(todo.id)}
                            className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )
                    })}
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
