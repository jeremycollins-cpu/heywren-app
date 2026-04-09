'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface TodoSource {
  type: string   // 'commitment' | 'missed_email' | 'missed_chat' | 'waiting_room' | 'mention' | 'manual'
  id?: string    // source item ID for back-linking
}

interface TodoContextValue {
  todoPanelOpen: boolean
  openTodoPanel: () => void
  closeTodoPanel: () => void
  toggleTodoPanel: () => void
  // For adding from other pages — pre-fills the title and opens the panel
  addTodoFromPage: (title: string, source?: TodoSource) => void
  pendingTitle: string | null
  pendingSource: TodoSource | null
  clearPendingTitle: () => void
}

const TodoContext = createContext<TodoContextValue | undefined>(undefined)

export function TodoProvider({ children }: { children: ReactNode }) {
  const [todoPanelOpen, setTodoPanelOpen] = useState(false)
  const [pendingTitle, setPendingTitle] = useState<string | null>(null)
  const [pendingSource, setPendingSource] = useState<TodoSource | null>(null)

  const openTodoPanel = useCallback(() => setTodoPanelOpen(true), [])
  const closeTodoPanel = useCallback(() => setTodoPanelOpen(false), [])
  const toggleTodoPanel = useCallback(() => setTodoPanelOpen(prev => !prev), [])

  const addTodoFromPage = useCallback((title: string, source?: TodoSource) => {
    setPendingTitle(title)
    setPendingSource(source || null)
    setTodoPanelOpen(true)
  }, [])

  const clearPendingTitle = useCallback(() => {
    setPendingTitle(null)
    setPendingSource(null)
  }, [])

  return (
    <TodoContext.Provider value={{
      todoPanelOpen,
      openTodoPanel,
      closeTodoPanel,
      toggleTodoPanel,
      addTodoFromPage,
      pendingTitle,
      pendingSource,
      clearPendingTitle,
    }}>
      {children}
    </TodoContext.Provider>
  )
}

export function useTodo() {
  const ctx = useContext(TodoContext)
  if (!ctx) throw new Error('useTodo must be used within TodoProvider')
  return ctx
}
