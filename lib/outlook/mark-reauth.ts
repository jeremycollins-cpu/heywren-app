// lib/outlook/mark-reauth.ts
// When Microsoft returns `invalid_grant` the refresh token is permanently dead
// (revoked, expired beyond the sliding window, or admin consent was pulled).
// No retry will ever succeed — the user has to click "Connect Outlook" again.
//
// This helper centralises the one-time side-effects for that case:
//   1. Flip `config.reauth_required = true` so every code path short-circuits
//      instead of re-hitting the token endpoint every sync cycle.
//   2. Log a single deduped system_error (errorKey scoped to the integration).
//   3. Drop one unread notification per integration so the user actually sees it.
//
// `app/api/integrations/outlook/connect/route.ts` upserts `config` wholesale on
// reconnect, so the flag naturally clears on a successful reconnect.

import type { SupabaseClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/monitoring/report-error'

export interface MarkReauthArgs {
  supabase: SupabaseClient
  integrationId: string
  provider: string
  userId: string
  teamId: string
  oauthError: string
}

export async function markReauthRequired(args: MarkReauthArgs): Promise<void> {
  const { supabase, integrationId, provider, userId, teamId, oauthError } = args

  const { data: current } = await supabase
    .from('integrations')
    .select('config')
    .eq('id', integrationId)
    .single()

  const config = (current?.config as Record<string, unknown> | null) || {}
  if (config.reauth_required === true) return

  await supabase
    .from('integrations')
    .update({
      config: {
        ...config,
        reauth_required: true,
        reauth_detected_at: new Date().toISOString(),
        reauth_reason: oauthError,
      },
    })
    .eq('id', integrationId)

  const { data: existingNotif } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('type', 'integration_error')
    .eq('read', false)
    .ilike('title', `%${provider}%expired%`)
    .limit(1)
    .maybeSingle()

  if (!existingNotif) {
    await supabase.from('notifications').insert({
      user_id: userId,
      team_id: teamId,
      type: 'integration_error',
      title: `${capitalize(provider)} connection expired`,
      body: `Your ${capitalize(provider)} token was revoked and can't be refreshed. Please reconnect your account so Wren can continue scanning your emails and calendar.`,
      link: '/integrations',
      read: false,
    })
  }

  await reportError({
    source: `${provider}/oauth`,
    message: `${provider} refresh token invalid — user reconnect required`,
    severity: 'error',
    userId,
    teamId,
    errorKey: `reauth_required:${provider}:${integrationId}`,
    details: { integrationId, oauthError },
  })
}

export function isReauthRequired(config: unknown): boolean {
  return !!(config && typeof config === 'object' && (config as Record<string, unknown>).reauth_required === true)
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
