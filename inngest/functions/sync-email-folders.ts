// inngest/functions/sync-email-folders.ts
// Periodically syncs mail folder metadata from Microsoft Graph into the
// email_folders cache table. Runs every 6 hours to keep the folder picker fresh.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { listMailFolders } from '@/lib/outlook/graph-client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const syncEmailFolders = inngest.createFunction(
  { id: 'sync-email-folders', retries: 2, concurrency: { limit: 5 } },
  { cron: 'TZ=America/Los_Angeles 0 */6 * * *' }, // Every 6 hours
  async ({ step }) => {
    const supabase = getAdminClient()

    // Find all users with active Outlook integrations
    const integrations = await step.run('fetch-integrations', async () => {
      const { data } = await supabase
        .from('integrations')
        .select('id, team_id, user_id, access_token, refresh_token')
        .eq('provider', 'outlook')

      return data || []
    })

    let synced = 0
    let errors = 0

    for (const integration of integrations) {
      await step.run(`sync-folders-${integration.user_id}`, async () => {
        try {
          const ctx = {
            supabase,
            integrationId: integration.id,
            refreshToken: integration.refresh_token,
          }

          const { folders } = await listMailFolders(integration.access_token, ctx)

          const now = new Date().toISOString()
          for (const folder of folders) {
            await supabase.from('email_folders').upsert(
              {
                team_id: integration.team_id,
                user_id: integration.user_id,
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

          synced++
        } catch (err) {
          console.error(`[sync-email-folders] Error for user ${integration.user_id}:`, (err as Error).message)
          errors++
        }
      })
    }

    return { synced, errors, total: integrations.length }
  }
)
