// lib/outlook/graph-client.ts
// Microsoft Graph API helpers for email folder and rule management.
// Uses the same token refresh pattern as sync-outlook.ts.

import { createClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/monitoring/report-error'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

// System folders that should not be offered as move targets
const SYSTEM_FOLDER_NAMES = new Set([
  'Drafts', 'Sent Items', 'Deleted Items', 'Outbox',
  'Conversation History', 'Sync Issues', 'Junk Email',
])

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Token management ────────────────────────────────────────────────────

async function refreshToken(
  supabase: ReturnType<typeof getAdminClient>,
  integrationId: string,
  refreshTokenValue: string
): Promise<string | null> {
  const tokenRes = await fetch(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshTokenValue,
        scope: 'openid profile email Mail.Read Mail.ReadWrite MailboxSettings.ReadWrite Calendars.ReadWrite User.Read offline_access',
      }),
    }
  )

  const data = await tokenRes.json()
  if (!data.access_token) {
    console.error('[graph-client] Token refresh failed:', data.error_description || data.error)
    await reportError({ source: 'graph-client', message: `Token refresh failed: ${data.error_description || data.error}`, severity: 'critical', errorKey: 'token_refresh_failed', details: { error: data.error, description: data.error_description } })
    return null
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // Read existing config to preserve user metadata (microsoft_user_id, display_name, email)
  const { data: current } = await supabase
    .from('integrations')
    .select('config')
    .eq('id', integrationId)
    .single()

  await supabase
    .from('integrations')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshTokenValue,
      config: { ...(current?.config || {}), token_expires_at: expiresAt },
    })
    .eq('id', integrationId)

  return data.access_token
}

/** Fetch from Graph with automatic 401 → token refresh → retry. */
export async function graphFetch(
  url: string,
  options: { method?: string; body?: unknown; token: string },
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ data: any; token: string }> {
  let currentToken = options.token

  const headers: Record<string, string> = {
    Authorization: `Bearer ${currentToken}`,
    'Content-Type': 'application/json',
  }

  const fetchOpts: RequestInit = { method: options.method || 'GET', headers }
  if (options.body) fetchOpts.body = JSON.stringify(options.body)

  let res = await fetch(url, fetchOpts)

  if (res.status === 401) {
    const newToken = await refreshToken(ctx.supabase, ctx.integrationId, ctx.refreshToken)
    if (!newToken) {
      return { data: { error: 'Token refresh failed' }, token: currentToken }
    }
    currentToken = newToken
    headers.Authorization = `Bearer ${currentToken}`
    res = await fetch(url, { ...fetchOpts, headers })
  }

  // 204 No Content (common for DELETE / move)
  if (res.status === 204) {
    return { data: { success: true }, token: currentToken }
  }

  return { data: await res.json(), token: currentToken }
}

// ── Integration lookup ──────────────────────────────────────────────────

export interface OutlookIntegration {
  id: string
  access_token: string
  refresh_token: string
  team_id: string
  user_id: string
}

export async function getOutlookIntegration(
  teamId: string,
  userId: string
): Promise<OutlookIntegration | null> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('integrations')
    .select('id, access_token, refresh_token, team_id, user_id')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('provider', 'outlook')
    .single()

  return data as OutlookIntegration | null
}

// ── Folder operations ───────────────────────────────────────────────────

export interface GraphMailFolder {
  id: string
  displayName: string
  parentFolderId: string | null
  totalItemCount: number
  unreadItemCount: number
}

/** List all mail folders from Graph API. */
export async function listMailFolders(
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ folders: GraphMailFolder[]; token: string }> {
  const url = `${GRAPH_BASE}/me/mailFolders?$select=id,displayName,parentFolderId,totalItemCount,unreadItemCount&$top=100`
  const { data, token: newToken } = await graphFetch(url, { token }, ctx)

  if (data.error) {
    console.error('[graph-client] listMailFolders error:', data.error)
    return { folders: [], token: newToken }
  }

  const folders: GraphMailFolder[] = (data.value || []).filter(
    (f: any) => !SYSTEM_FOLDER_NAMES.has(f.displayName)
  )

  return { folders, token: newToken }
}

/** Create a new mail folder in Outlook. */
export async function createMailFolder(
  displayName: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ folder: GraphMailFolder | null; token: string; error?: string }> {
  const url = `${GRAPH_BASE}/me/mailFolders`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'POST', body: { displayName }, token },
    ctx
  )

  if (data.error) {
    return { folder: null, token: newToken, error: data.error.message || 'Failed to create folder' }
  }

  return { folder: data as GraphMailFolder, token: newToken }
}

// ── Message operations ──────────────────────────────────────────────────

/** Move a single email to a different folder. */
export async function moveMessage(
  messageId: string,
  destinationFolderId: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string; error?: string }> {
  const url = `${GRAPH_BASE}/me/messages/${messageId}/move`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'POST', body: { destinationId: destinationFolderId }, token },
    ctx
  )

  if (data.error) {
    return { success: false, token: newToken, error: data.error.message || 'Move failed' }
  }

  return { success: true, token: newToken }
}

/** Mark a single email as read in Outlook. */
export async function markMessageAsRead(
  messageId: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string }> {
  const url = `${GRAPH_BASE}/me/messages/${messageId}`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'PATCH', body: { isRead: true }, token },
    ctx
  )
  return { success: !data.error, token: newToken }
}

/** Archive a single email (move to Archive folder). */
export async function archiveMessage(
  messageId: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string }> {
  const url = `${GRAPH_BASE}/me/messages/${messageId}/move`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'POST', body: { destinationId: 'archive' }, token },
    ctx
  )
  return { success: !data.error, token: newToken }
}

/** Mark a single email as read AND archive it. */
export async function markReadAndArchive(
  messageId: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string }> {
  // Mark as read first, then archive
  const readResult = await markMessageAsRead(messageId, token, ctx)
  const archiveResult = await archiveMessage(messageId, readResult.token, ctx)
  return archiveResult
}

/** Search inbox for messages matching a sender email. */
export async function searchMessagesBySender(
  senderEmail: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string },
  maxResults = 50
): Promise<{ messageIds: string[]; token: string }> {
  const filter = encodeURIComponent(`from/emailAddress/address eq '${senderEmail}'`)
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$filter=${filter}&$select=id&$top=${maxResults}`
  const { data, token: newToken } = await graphFetch(url, { token }, ctx)

  if (data.error) {
    console.error('[graph-client] searchMessagesBySender error:', data.error)
    return { messageIds: [], token: newToken }
  }

  const messageIds = (data.value || []).map((m: any) => m.id)
  return { messageIds, token: newToken }
}

/** Search inbox for messages matching a sender domain. */
export async function searchMessagesByDomain(
  domain: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string },
  maxResults = 50
): Promise<{ messageIds: string[]; token: string }> {
  // Graph $filter doesn't support endsWith on email, so use $search instead
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messages?$search="from:${domain}"&$select=id&$top=${maxResults}`
  const { data, token: newToken } = await graphFetch(url, { token }, ctx)

  if (data.error) {
    console.error('[graph-client] searchMessagesByDomain error:', data.error)
    return { messageIds: [], token: newToken }
  }

  const messageIds = (data.value || []).map((m: any) => m.id)
  return { messageIds, token: newToken }
}

// ── Inbox rule operations ───────────────────────────────────────────────

export interface GraphMessageRule {
  id: string
  displayName: string
  isEnabled: boolean
  conditions: Record<string, any>
  actions: Record<string, any>
}

/** List existing inbox rules. */
export async function listInboxRules(
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ rules: GraphMessageRule[]; token: string }> {
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messageRules?$select=id,displayName,isEnabled,conditions,actions`
  const { data, token: newToken } = await graphFetch(url, { token }, ctx)

  if (data.error) {
    console.error('[graph-client] listInboxRules error:', data.error)
    return { rules: [], token: newToken }
  }

  return { rules: data.value || [], token: newToken }
}

/** Create an inbox rule in Outlook. */
export async function createInboxRule(
  params: {
    matchType: 'from_email' | 'from_domain' | 'subject_contains'
    matchValue: string
    targetFolderId: string
    targetFolderName?: string
    markAsRead?: boolean
  },
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ rule: GraphMessageRule | null; token: string; error?: string }> {
  // Build conditions based on match type
  const conditions: Record<string, any> = {}
  switch (params.matchType) {
    case 'from_email':
      conditions.senderContains = [params.matchValue]
      break
    case 'from_domain':
      conditions.senderContains = [`@${params.matchValue}`]
      break
    case 'subject_contains':
      conditions.subjectContains = [params.matchValue]
      break
  }

  const actions: Record<string, any> = {
    moveToFolder: params.targetFolderId,
  }
  if (params.markAsRead) {
    actions.markAsRead = true
  }

  const displayName = `HeyWren: ${params.matchValue} → ${params.targetFolderName || params.targetFolderId}`

  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messageRules`
  const { data, token: newToken } = await graphFetch(
    url,
    {
      method: 'POST',
      body: {
        displayName,
        sequence: 1,
        isEnabled: true,
        conditions,
        actions,
      },
      token,
    },
    ctx
  )

  if (data.error) {
    return { rule: null, token: newToken, error: data.error.message || 'Failed to create rule' }
  }

  return { rule: data as GraphMessageRule, token: newToken }
}

/** Delete an inbox rule from Outlook. */
export async function deleteInboxRule(
  ruleId: string,
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string; error?: string }> {
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messageRules/${ruleId}`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'DELETE', token },
    ctx
  )

  if (data.error) {
    return { success: false, token: newToken, error: data.error.message || 'Failed to delete rule' }
  }

  return { success: true, token: newToken }
}

/** Update an inbox rule (enable/disable). */
export async function updateInboxRule(
  ruleId: string,
  updates: { isEnabled?: boolean },
  token: string,
  ctx: { supabase: ReturnType<typeof getAdminClient>; integrationId: string; refreshToken: string }
): Promise<{ success: boolean; token: string; error?: string }> {
  const url = `${GRAPH_BASE}/me/mailFolders/inbox/messageRules/${ruleId}`
  const { data, token: newToken } = await graphFetch(
    url,
    { method: 'PATCH', body: updates, token },
    ctx
  )

  if (data.error) {
    return { success: false, token: newToken, error: data.error.message || 'Failed to update rule' }
  }

  return { success: true, token: newToken }
}
