// app/(dashboard)/api/email-folders/route.ts
// GET: List cached mail folders (refreshes from Graph if stale >1hr)
// POST: Create a new mail folder in Outlook

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import {
  getOutlookIntegration,
  listMailFolders,
  createMailFolder,
} from '@/lib/outlook/graph-client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const teamId = profile.current_team_id
    const userId = userData.user.id
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

    // Check cache freshness
    const { data: cached } = await admin
      .from('email_folders')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .order('display_name', { ascending: true })

    const isFresh = cached && cached.length > 0 && cached[0].last_synced_at &&
      Date.now() - new Date(cached[0].last_synced_at).getTime() < CACHE_TTL_MS

    if (isFresh && !forceRefresh) {
      return NextResponse.json({ folders: cached, fromCache: true })
    }

    // Fetch fresh from Graph API
    const integration = await getOutlookIntegration(teamId, userId)
    if (!integration) {
      // Return cache even if stale, or empty if no integration
      return NextResponse.json({
        folders: cached || [],
        fromCache: true,
        needsConnection: true,
      })
    }

    const ctx = {
      supabase: admin,
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    const { folders } = await listMailFolders(integration.access_token, ctx)

    if (folders.length === 0 && cached && cached.length > 0) {
      // Graph returned nothing (possibly a scope error) — return stale cache
      return NextResponse.json({ folders: cached, fromCache: true, scopeWarning: true })
    }

    // Upsert into cache
    const now = new Date().toISOString()
    for (const folder of folders) {
      await admin.from('email_folders').upsert(
        {
          team_id: teamId,
          user_id: userId,
          folder_id: folder.id,
          display_name: folder.displayName,
          parent_folder_id: folder.parentFolderId || null,
          is_custom: !['Inbox', 'Archive', 'Clutter', 'RSS Feeds', 'RSS Subscriptions'].includes(folder.displayName),
          message_count: folder.totalItemCount,
          unread_count: folder.unreadItemCount,
          last_synced_at: now,
        },
        { onConflict: 'team_id,user_id,folder_id' }
      )
    }

    // Re-fetch from DB to get consistent format
    const { data: fresh } = await admin
      .from('email_folders')
      .select('*')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .order('display_name', { ascending: true })

    return NextResponse.json({ folders: fresh || [], fromCache: false })
  } catch (err) {
    console.error('Email folders GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { displayName } = await request.json()
    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const teamId = profile.current_team_id
    const userId = userData.user.id

    const integration = await getOutlookIntegration(teamId, userId)
    if (!integration) {
      return NextResponse.json({ error: 'Outlook not connected' }, { status: 400 })
    }

    const ctx = {
      supabase: admin,
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    // Create in Outlook
    const { folder, error } = await createMailFolder(displayName.trim(), integration.access_token, ctx)
    if (!folder) {
      return NextResponse.json({ error: error || 'Failed to create folder' }, { status: 500 })
    }

    // Cache locally
    const now = new Date().toISOString()
    await admin.from('email_folders').upsert(
      {
        team_id: teamId,
        user_id: userId,
        folder_id: folder.id,
        display_name: folder.displayName,
        parent_folder_id: folder.parentFolderId || null,
        is_custom: true,
        message_count: 0,
        unread_count: 0,
        last_synced_at: now,
      },
      { onConflict: 'team_id,user_id,folder_id' }
    )

    return NextResponse.json({ folder: { ...folder, folder_id: folder.id } })
  } catch (err) {
    console.error('Email folders POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
