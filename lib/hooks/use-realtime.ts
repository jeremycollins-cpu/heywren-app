'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'

type PostgresAction = 'INSERT' | 'UPDATE' | 'DELETE'

interface UseRealtimeOptions {
  table: string
  schema?: string
  filter?: string
  event?: PostgresAction | '*'
  onInsert?: (payload: RealtimePostgresChangesPayload<any>) => void
  onUpdate?: (payload: RealtimePostgresChangesPayload<any>) => void
  onDelete?: (payload: RealtimePostgresChangesPayload<any>) => void
  enabled?: boolean
}

/**
 * Subscribe to Supabase Realtime changes for a given table.
 * Automatically manages the channel lifecycle (subscribe on mount, unsubscribe on unmount).
 */
export function useRealtime({
  table,
  schema = 'public',
  filter,
  event = '*',
  onInsert,
  onUpdate,
  onDelete,
  enabled = true,
}: UseRealtimeOptions) {
  // Use refs so callback changes don't cause re-subscriptions
  const callbacksRef = useRef({ onInsert, onUpdate, onDelete })
  callbacksRef.current = { onInsert, onUpdate, onDelete }

  useEffect(() => {
    if (!enabled) return

    const supabase = createClient()
    const channelName = `realtime:${table}${filter ? `:${filter}` : ''}`

    const channelConfig: any = {
      event,
      schema,
      table,
    }
    if (filter) {
      channelConfig.filter = filter
    }

    const channel: RealtimeChannel = supabase
      .channel(channelName)
      .on('postgres_changes', channelConfig, (payload: RealtimePostgresChangesPayload<any>) => {
        const { onInsert, onUpdate, onDelete } = callbacksRef.current
        switch (payload.eventType) {
          case 'INSERT':
            onInsert?.(payload)
            break
          case 'UPDATE':
            onUpdate?.(payload)
            break
          case 'DELETE':
            onDelete?.(payload)
            break
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, schema, filter, event, enabled])
}
