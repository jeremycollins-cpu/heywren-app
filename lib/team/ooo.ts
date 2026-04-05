// lib/team/ooo.ts
// Utility functions for checking out-of-office status.
// Used by scoring, alerts, and anomaly detection to exclude OOO users.
// Also checks company_holidays — on company holidays, ALL org members are OOO.

import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Returns dates within [rangeStart, rangeEnd] that are company holidays.
 * Recurring holidays are matched by month+day regardless of year.
 */
async function getCompanyHolidayDates(
  organizationId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Set<string>> {
  const supabase = getAdminClient()

  const { data } = await supabase
    .from('company_holidays')
    .select('date, recurring')
    .eq('organization_id', organizationId)

  const holidays = new Set<string>()
  if (!data) return holidays

  const start = new Date(rangeStart + 'T00:00:00Z')
  const end = new Date(rangeEnd + 'T00:00:00Z')

  for (const h of data as Array<{ date: string; recurring: boolean }>) {
    if (h.recurring) {
      // For recurring holidays, check if the month+day falls within the range
      const [, mm, dd] = h.date.split('-')
      // Check each year the range spans
      for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
        const candidate = `${y}-${mm}-${dd}`
        if (candidate >= rangeStart && candidate <= rangeEnd) {
          holidays.add(candidate)
        }
      }
    } else {
      if (h.date >= rangeStart && h.date <= rangeEnd) {
        holidays.add(h.date)
      }
    }
  }

  return holidays
}

/**
 * Check if a specific date is a company holiday.
 */
export async function isCompanyHoliday(
  organizationId: string,
  date: string
): Promise<boolean> {
  const holidays = await getCompanyHolidayDates(organizationId, date, date)
  return holidays.size > 0
}

/**
 * Returns all org member user IDs (needed when a company holiday means everyone is OOO).
 */
async function getAllOrgMemberIds(organizationId: string): Promise<string[]> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)

  return (data || []).map((r: { user_id: string }) => r.user_id)
}

/**
 * Returns the set of user IDs that are OOO for any part of the given date range.
 * A user is considered OOO if:
 * 1. They have an active ooo_period that overlaps the range, OR
 * 2. A company holiday falls within the range (everyone is OOO)
 */
export async function getOooUserIds(
  organizationId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Set<string>> {
  const supabase = getAdminClient()

  const [periodsResult, holidayDates] = await Promise.all([
    supabase
      .from('ooo_periods')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .lte('start_date', rangeEnd)
      .gte('end_date', rangeStart),
    getCompanyHolidayDates(organizationId, rangeStart, rangeEnd),
  ])

  const oooUsers = new Set(
    (periodsResult.data || []).map((r: { user_id: string }) => r.user_id)
  )

  // If there's a company holiday in the range, everyone is OOO
  if (holidayDates.size > 0) {
    const allMembers = await getAllOrgMemberIds(organizationId)
    for (const uid of allMembers) oooUsers.add(uid)
  }

  return oooUsers
}

/**
 * Returns OOO user IDs for a specific date (e.g. today).
 */
export async function getOooUserIdsForDate(
  organizationId: string,
  date: string
): Promise<Set<string>> {
  return getOooUserIds(organizationId, date, date)
}

/**
 * Check if a specific user is OOO on a given date.
 */
export async function isUserOoo(
  organizationId: string,
  userId: string,
  date: string
): Promise<boolean> {
  const oooUsers = await getOooUserIdsForDate(organizationId, date)
  return oooUsers.has(userId)
}
