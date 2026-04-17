// inngest/functions/sync-asana.ts
// Syncs Asana tasks assigned to a connected user. Triggered on initial connect
// and on a daily cron schedule.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { asanaFetch, type AsanaIntegrationRow } from '@/lib/asana/client'

const PAGE_LIMIT = 100
const MAX_PAGES = 20  // Hard cap: 20 * 100 = 2000 tasks per sync run

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface AsanaTask {
  gid: string
  name: string
  notes?: string
  permalink_url?: string
  completed: boolean
  completed_at?: string | null
  due_on?: string | null
  due_at?: string | null
  assignee?: { gid: string } | null
  workspace?: { gid: string; name: string } | null
  projects?: Array<{ gid: string; name: string }>
  created_at?: string
  modified_at?: string
}

// ── Event-triggered sync ────────────────────────────────────────

export const syncAsanaTasks = inngest.createFunction(
  {
    id: 'sync-asana-tasks',
    name: 'Sync Asana Tasks',
    concurrency: { limit: 5 },
    retries: 2,
  },
  { event: 'asana/sync.tasks' },
  async ({ event, step }) => {
    const { user_id, team_id, organization_id, is_initial_sync } = event.data
    const supabase = getAdminClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('id, access_token, refresh_token, config')
      .eq('user_id', user_id)
      .eq('provider', 'asana')
      .single()

    if (!integration?.access_token) {
      console.error('[sync-asana] No Asana integration found for user:', user_id)
      return { error: 'No Asana integration' }
    }

    const integ: AsanaIntegrationRow = {
      id: integration.id,
      access_token: integration.access_token,
      refresh_token: integration.refresh_token,
      config: integration.config,
    }

    const userGid = integration.config?.asana_user_gid as string | undefined
    const workspaces: Array<{ gid: string; name: string }> = integration.config?.workspaces || []

    if (!userGid || workspaces.length === 0) {
      console.error('[sync-asana] Missing user gid or workspaces in config')
      return { error: 'Asana integration config incomplete' }
    }

    await supabase
      .from('asana_sync_cursors')
      .update({ sync_status: 'syncing', updated_at: new Date().toISOString() })
      .eq('user_id', user_id)

    try {
      let totalTasks = 0
      const allRows: any[] = []

      // Fetch tasks assigned to the user, per workspace. Asana's tasks search
      // requires `assignee` + `workspace` together. We fetch with rich opt_fields
      // so a single API page contains everything we need.
      const optFields = [
        'name',
        'notes',
        'permalink_url',
        'completed',
        'completed_at',
        'due_on',
        'due_at',
        'assignee.gid',
        'workspace.gid',
        'workspace.name',
        'projects.gid',
        'projects.name',
        'created_at',
        'modified_at',
      ].join(',')

      // Incremental syncs only refresh open tasks + recently-modified completed
      // ones. Initial sync pulls everything (subject to MAX_PAGES cap).
      const completedSinceParam = is_initial_sync
        ? ''
        : `&completed_since=${encodeURIComponent(
            new Date(Date.now() - 14 * 86400000).toISOString()
          )}`

      for (const ws of workspaces) {
        const tasks = await step.run(`fetch-tasks-${ws.gid}`, async () => {
          const collected: AsanaTask[] = []
          let offset: string | undefined
          let pages = 0

          while (pages < MAX_PAGES) {
            const offsetParam = offset ? `&offset=${encodeURIComponent(offset)}` : ''
            const path = `/tasks?assignee=${userGid}&workspace=${ws.gid}&limit=${PAGE_LIMIT}&opt_fields=${optFields}${completedSinceParam}${offsetParam}`
            const data: { data: AsanaTask[]; next_page?: { offset: string } | null } =
              await asanaFetch(supabase, integ, path)

            if (data.data?.length) collected.push(...data.data)
            if (!data.next_page?.offset) break
            offset = data.next_page.offset
            pages++
          }

          return collected
        })

        for (const t of tasks) {
          const project = t.projects?.[0]
          allRows.push({
            user_id,
            team_id,
            organization_id,
            asana_gid: t.gid,
            workspace_gid: t.workspace?.gid || ws.gid,
            project_gid: project?.gid || null,
            project_name: project?.name || null,
            name: t.name,
            notes: t.notes || null,
            permalink_url: t.permalink_url || null,
            completed: !!t.completed,
            completed_at: t.completed_at || null,
            due_on: t.due_on || null,
            due_at: t.due_at || null,
            assignee_gid: t.assignee?.gid || userGid,
            asana_created_at: t.created_at || null,
            asana_modified_at: t.modified_at || null,
            metadata: {
              workspace_name: ws.name,
              project_count: t.projects?.length || 0,
            },
            updated_at: new Date().toISOString(),
          })
        }
      }

      // Upsert in batches of 50 to avoid hitting payload limits.
      for (let i = 0; i < allRows.length; i += 50) {
        const batch = allRows.slice(i, i + 50)
        await step.run(`upsert-batch-${i}`, async () => {
          const { error } = await supabase
            .from('asana_tasks')
            .upsert(batch, { onConflict: 'user_id,asana_gid' })
          if (error) console.error('[sync-asana] Upsert error:', error)
        })
      }

      totalTasks = allRows.length

      await supabase
        .from('asana_sync_cursors')
        .update({
          sync_status: 'idle',
          last_synced_at: new Date().toISOString(),
          tasks_synced: totalTasks,
          sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)

      return { synced: totalTasks, workspaces: workspaces.length }
    } catch (err: any) {
      console.error('[sync-asana] Sync error:', err)

      await supabase
        .from('asana_sync_cursors')
        .update({
          sync_status: 'error',
          sync_error: err.message?.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)

      throw err
    }
  }
)

// ── Daily cron sync for all connected users ──────────────────────

export const syncAsanaDaily = inngest.createFunction(
  {
    id: 'sync-asana-daily',
    name: 'Daily Asana Sync',
  },
  { cron: '15 6 * * *' },  // 6:15 AM UTC — staggered after GitHub (6:00) to spread load
  async ({ step }) => {
    const supabase = getAdminClient()

    const { data: integrations } = await supabase
      .from('integrations')
      .select('user_id, team_id')
      .eq('provider', 'asana')

    if (!integrations?.length) return { message: 'No Asana integrations to sync' }

    const events = integrations.map((int) => ({
      name: 'asana/sync.tasks' as const,
      data: {
        user_id: int.user_id,
        team_id: int.team_id,
        organization_id: null,
        is_initial_sync: false,
      },
    }))

    await step.run('fan-out-syncs', async () => {
      await inngest.send(events)
    })

    return { triggered: events.length }
  }
)
