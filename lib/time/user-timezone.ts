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
 *
 * Uses Intl.DateTimeFormat.formatToParts() for reliable timezone conversion.
 * Avoids the fragile `new Date(d.toLocaleString())` pattern which breaks in
 * Node 18+ due to Unicode narrow no-break space (\u202f) in locale output,
 * and produces wrong results when the server timezone is not UTC.
 */
export function toLocalTime(utcTimestamp: string, timezone: string): LocalTime {
  const d = new Date(utcTimestamp)

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value || ''

  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hours = parseInt(get('hour'), 10)
  const minutes = parseInt(get('minute'), 10)

  const weekdayStr = get('weekday')
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }

  return {
    dateStr: `${year}-${month}-${day}`,
    dayOfWeek: weekdayMap[weekdayStr] ?? new Date(
      `${year}-${month}-${day}T12:00:00Z`
    ).getUTCDay(),
    hours,
    minutes,
    timeMinutes: hours * 60 + minutes,
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
  const today = todayInTimezone(timezone)
  const [y, m, d] = today.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, d - 1, 12)) // noon UTC avoids DST edge cases
  const yy = prev.getUTCFullYear()
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(prev.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
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
