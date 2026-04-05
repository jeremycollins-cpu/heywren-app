// lib/team/ooo.ts
// Utility functions for checking out-of-office status.
// Used by scoring, alerts, and anomaly detection to exclude OOO users.

import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Returns the set of user IDs that are OOO for any part of the given date range.
 * A user is considered OOO if they have an active ooo_period that overlaps the range.
 */
export async function getOooUserIds(
  organizationId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<Set<string>> {
  const supabase = getAdminClient()

  const { data } = await supabase
    .from('ooo_periods')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .lte('start_date', rangeEnd)
    .gte('end_date', rangeStart)

  return new Set((data || []).map((r: { user_id: string }) => r.user_id))
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
