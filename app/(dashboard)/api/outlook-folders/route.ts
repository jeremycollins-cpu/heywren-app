export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Get the user's Outlook integration token
  const { data: integration } = await supabase
    .from('integrations')
    .select('access_token, refresh_token, config, id')
    .eq('user_id', user.id)
    .eq('provider', 'outlook')
    .limit(1)
    .maybeSingle()

  if (!integration?.access_token) {
    return NextResponse.json({ folders: [], error: 'No Outlook integration found' })
  }

  try {
    // Fetch top-level mail folders from Microsoft Graph
    let res = await fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount&$top=50',
      { headers: { Authorization: `Bearer ${integration.access_token}` } }
    )

    // If token expired, try refreshing
    if (res.status === 401) {
      const tokenRes = await fetch(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || '',
            client_secret: process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '',
            refresh_token: integration.refresh_token,
            grant_type: 'refresh_token',
            scope: 'openid profile email Mail.Read offline_access',
          }).toString(),
        }
      )
      const tokenData = await tokenRes.json()
      if (tokenData.error) {
        return NextResponse.json({ folders: [], error: 'Token refresh failed' })
      }

      // Update stored token + expiry timestamp
      const newExpiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
      await supabase
        .from('integrations')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || integration.refresh_token,
          config: {
            ...(integration.config || {}),
            token_expires_at: newExpiresAt,
          },
        })
        .eq('id', integration.id)

      res = await fetch(
        'https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName,totalItemCount,unreadItemCount&$top=50',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      )
    }

    const data = await res.json()
    if (data.error) {
      return NextResponse.json({ folders: [], error: data.error.message || 'Graph API error' })
    }

    const folders = (data.value || []).map((f: any) => ({
      id: f.id,
      name: f.displayName,
      totalCount: f.totalItemCount || 0,
      unreadCount: f.unreadItemCount || 0,
    }))

    // Also fetch child folders for common parents (Inbox often has sub-folders)
    const childFolders: typeof folders = []
    for (const folder of folders) {
      if (folder.totalCount > 0 || ['Inbox', 'Top of Information Store'].includes(folder.name)) {
        try {
          const childRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/mailFolders/${folder.id}/childFolders?$select=id,displayName,totalItemCount,unreadItemCount&$top=20`,
            { headers: { Authorization: `Bearer ${res.headers.get('x-ms-token') || integration.access_token}` } }
          )
          // Use the same token that worked for the parent request
          const childData = await childRes.json()
          if (childData.value) {
            for (const child of childData.value) {
              childFolders.push({
                id: child.id,
                name: `${folder.name} / ${child.displayName}`,
                totalCount: child.totalItemCount || 0,
                unreadCount: child.unreadItemCount || 0,
              })
            }
          }
        } catch {
          // Non-fatal — skip child folders on error
        }
      }
    }

    return NextResponse.json({
      folders: [...folders, ...childFolders].sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (err) {
    return NextResponse.json({ folders: [], error: (err as Error).message })
  }
}
