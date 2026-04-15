// lib/time/user-timezone.ts
// Shared timezone utilities for converting UTC timestamps to a user's local time.
// Used across anomaly detection, nudges, morning briefs, and calendar conflicts.

import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface LocalTime {
  dateStr: string      // YYYY-MM-DD in local timezone
  dayOfWeek: number    // 0=Sun, 1=Mon, ..., 6=Sat
  hours: number        // 0-23 in local timezone
  minutes: number      // 0-59
  timeMinutes: number  // hours*60+minutes (for schedule comparison)
  formatted: string    // "3:45 PM" style
}

/**
 * Convert a UTC timestamp to local date/time in the given IANA timezone.
 */
export function toLocalTime(utcTimestamp: string, timezone: string): LocalTime {
  const d = new Date(utcTimestamp)
  // Use toLocaleString to get the local date/time components
  const local = new Date(d.toLocaleString('en-US', { timeZone: timezone }))
  const year = local.getFullYear()
  const month = String(local.getMonth() + 1).padStart(2, '0')
  const day = String(local.getDate()).padStart(2, '0')

  return {
    dateStr: `${year}-${month}-${day}`,
    dayOfWeek: local.getDay(),
    hours: local.getHours(),
    minutes: local.getMinutes(),
    timeMinutes: local.getHours() * 60 + local.getMinutes(),
    formatted: d.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    }),
  }
}

/**
 * Get "today" as a YYYY-MM-DD string in the given timezone.
 */
export function todayInTimezone(timezone: string): string {
  return toLocalTime(new Date().toISOString(), timezone).dateStr
}

/**
 * Get "yesterday" as a YYYY-MM-DD string in the given timezone.
 */
export function yesterdayInTimezone(timezone: string): string {
  const yesterday = new Date(Date.now() - 86400000)
  return toLocalTime(yesterday.toISOString(), timezone).dateStr
}

/**
 * Resolve a user's timezone: check work_schedules first, then org timezone, then fallback.
 */
export async function resolveUserTimezone(
  userId: string,
  orgId?: string,
  fallback = 'America/New_York'
): Promise<string> {
  const admin = getAdminClient()

  // Check user's work schedule for a timezone override
  const { data: schedule } = await admin
    .from('work_schedules')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle()

  if (schedule?.timezone) return schedule.timezone

  // Fall back to org timezone
  if (orgId) {
    const { data: org } = await admin
      .from('organizations')
      .select('timezone')
      .eq('id', orgId)
      .single()

    if (org?.timezone) return org.timezone
  }

  return fallback
}
