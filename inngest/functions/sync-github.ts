// inngest/functions/sync-github.ts
// Syncs GitHub activity (commits, PRs opened/merged/reviewed) for a user.
// Triggered on initial connect and then on a daily cron schedule.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectAiSignature, mergeAiSignatures } from '@/lib/github/ai-signature'

const GITHUB_API = 'https://api.github.com'
const MAX_PAGES = 10
const PER_PAGE = 100
// How far back to look on initial sync (90 days)
const INITIAL_SYNC_DAYS = 90
// Safety cap on per-PR stat hydration calls per sync run.
// Protects against runaway rate-limit usage for unusually active users.
const MAX_PR_HYDRATIONS = 100
// Budget for backfilling line stats on historical PR events that were
// synced before stat hydration shipped (or were missed). Each daily sync
// chips away at the backlog until it's drained.
const MAX_PR_BACKFILLS = 50

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function githubFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API error (${res.status}): ${body}`)
  }
  return res.json()
}

// ── Event-triggered sync ────────────────────────────────────────

export const syncGithubEvents = inngest.createFunction(
  {
    id: 'sync-github-events',
    name: 'Sync GitHub Events',
    concurrency: { limit: 5 },
    retries: 2,
  },
  { event: 'github/sync.events' },
  async ({ event, step }) => {
    const { user_id, team_id, organization_id, github_username, is_initial_sync } = event.data

    const supabase = getAdminClient()

    // Get access token
    const { data: integration } = await supabase
      .from('integrations')
      .select('access_token, config')
      .eq('user_id', user_id)
      .eq('provider', 'github')
      .single()

    if (!integration?.access_token) {
      console.error('[sync-github] No GitHub integration found for user:', user_id)
      return { error: 'No GitHub integration' }
    }

    const token = integration.access_token
    const username = github_username || integration.config?.github_username

    // Update sync status
    await supabase
      .from('github_sync_cursors')
      .update({ sync_status: 'syncing', updated_at: new Date().toISOString() })
      .eq('user_id', user_id)

    try {
      const since = is_initial_sync
        ? new Date(Date.now() - INITIAL_SYNC_DAYS * 86400000).toISOString()
        : new Date(Date.now() - 7 * 86400000).toISOString() // Last 7 days for incremental

      let totalEvents = 0

      // ── 1. Fetch commits across repos ──
      const commits = await step.run('fetch-commits', async () => {
        const events: any[] = []
        // Use the events API to get push events (which contain commits)
        let page = 1
        while (page <= MAX_PAGES) {
          const data = await githubFetch(
            `${GITHUB_API}/users/${username}/events?per_page=${PER_PAGE}&page=${page}`,
            token
          )
          if (!data.length) break

          for (const event of data) {
            // Filter to push events only
            if (event.type !== 'PushEvent') continue
            const eventDate = new Date(event.created_at)
            if (eventDate < new Date(since)) { page = MAX_PAGES + 1; break }

            const repo = event.repo?.name || 'unknown'
            for (const commit of (event.payload?.commits || [])) {
              const fullMessage = commit.message || ''
              const sig = detectAiSignature(fullMessage)
              events.push({
                github_id: commit.sha,
                event_type: 'commit',
                repo_name: repo,
                title: fullMessage.split('\n')[0].slice(0, 500),
                url: `https://github.com/${repo}/commit/${commit.sha}`,
                github_username: username,
                event_at: event.created_at,
                metadata: {
                  ai_assisted: sig.ai_assisted,
                  ai_tool: sig.tool,
                },
              })
            }
          }
          page++
        }
        return events
      })

      // ── 2. Fetch PRs authored ──
      const prsAuthored = await step.run('fetch-prs-authored', async () => {
        const events: any[] = []
        let page = 1
        while (page <= MAX_PAGES) {
          const data = await githubFetch(
            `${GITHUB_API}/search/issues?q=author:${username}+type:pr+updated:>=${since.split('T')[0]}&per_page=${PER_PAGE}&page=${page}&sort=updated&order=desc`,
            token
          )
          if (!data.items?.length) break

          for (const pr of data.items) {
            const repo = pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown'
            // Detect AI signature from PR title + body in one pass.
            const sig = mergeAiSignatures(
              detectAiSignature(pr.title),
              detectAiSignature(pr.body)
            )

            // PR opened
            events.push({
              github_id: `pr-${pr.number}-${repo}`,
              event_type: 'pr_opened',
              repo_name: repo,
              title: pr.title,
              url: pr.html_url,
              github_username: username,
              event_at: pr.created_at,
              metadata: {
                pr_number: pr.number,
                state: pr.state,
                labels: (pr.labels || []).map((l: any) => l.name),
                ai_assisted: sig.ai_assisted,
                ai_tool: sig.tool,
              },
            })

            // PR merged (if applicable)
            if (pr.pull_request?.merged_at) {
              events.push({
                github_id: `pr-merged-${pr.number}-${repo}`,
                event_type: 'pr_merged',
                repo_name: repo,
                title: pr.title,
                url: pr.html_url,
                github_username: username,
                event_at: pr.pull_request.merged_at,
                metadata: {
                  pr_number: pr.number,
                  ai_assisted: sig.ai_assisted,
                  ai_tool: sig.tool,
                },
              })
            } else if (pr.state === 'closed') {
              events.push({
                github_id: `pr-closed-${pr.number}-${repo}`,
                event_type: 'pr_closed',
                repo_name: repo,
                title: pr.title,
                url: pr.html_url,
                github_username: username,
                event_at: pr.closed_at || pr.updated_at,
                metadata: { pr_number: pr.number },
              })
            }
          }
          if (data.items.length < PER_PAGE) break
          page++
        }
        return events
      })

      // ── 2b. Hydrate line-count stats for each unique PR ──
      // The search API doesn't return additions/deletions/changed_files, so we
      // fetch the PR detail endpoint once per PR and apply the numbers to all
      // of its lifecycle events (opened + merged). One API call per PR.
      await step.run('hydrate-pr-stats', async () => {
        const statsByKey = new Map<string, { additions: number; deletions: number; changed_files: number }>()
        const seen = new Set<string>()

        for (const ev of prsAuthored) {
          const num = ev.metadata?.pr_number
          if (!num) continue
          const key = `${ev.repo_name}#${num}`
          if (seen.has(key)) continue
          seen.add(key)

          if (statsByKey.size >= MAX_PR_HYDRATIONS) break

          try {
            const detail = await githubFetch(
              `${GITHUB_API}/repos/${ev.repo_name}/pulls/${num}`,
              token
            )
            statsByKey.set(key, {
              additions: Number.isFinite(detail.additions) ? detail.additions : 0,
              deletions: Number.isFinite(detail.deletions) ? detail.deletions : 0,
              changed_files: Number.isFinite(detail.changed_files) ? detail.changed_files : 0,
            })
          } catch (err: any) {
            // Don't fail the whole sync over one unreachable PR (could be
            // private/archived/deleted). Just skip — the metric degrades
            // gracefully to "no data" for that PR.
            console.warn(`[sync-github] Stat hydration failed for ${key}:`, err?.message)
          }
        }

        // Apply stats in-place to all matching events (opened + merged).
        for (const ev of prsAuthored) {
          const key = `${ev.repo_name}#${ev.metadata?.pr_number}`
          const s = statsByKey.get(key)
          if (!s) continue
          ev.additions = s.additions
          ev.deletions = s.deletions
          ev.changed_files = s.changed_files
        }

        return { hydrated: statsByKey.size }
      })

      // ── 3. Fetch PR reviews ──
      const reviews = await step.run('fetch-reviews', async () => {
        const events: any[] = []
        let page = 1
        while (page <= MAX_PAGES) {
          const data = await githubFetch(
            `${GITHUB_API}/search/issues?q=reviewed-by:${username}+type:pr+updated:>=${since.split('T')[0]}&per_page=${PER_PAGE}&page=${page}&sort=updated&order=desc`,
            token
          )
          if (!data.items?.length) break

          for (const pr of data.items) {
            const repo = pr.repository_url?.replace('https://api.github.com/repos/', '') || 'unknown'
            // Only add if not authored by the same user (avoid self-reviews)
            if (pr.user?.login === username) continue

            events.push({
              github_id: `review-${pr.number}-${repo}-${username}`,
              event_type: 'pr_reviewed',
              repo_name: repo,
              title: pr.title,
              url: pr.html_url,
              github_username: username,
              event_at: pr.updated_at,
              metadata: { pr_number: pr.number, pr_author: pr.user?.login },
            })
          }
          if (data.items.length < PER_PAGE) break
          page++
        }
        return events
      })

      // ── 4. Upsert all events ──
      const allEvents = [...commits, ...prsAuthored, ...reviews]

      if (allEvents.length > 0) {
        const rows = allEvents.map(e => ({
          user_id,
          team_id,
          organization_id,
          github_id: e.github_id,
          event_type: e.event_type,
          repo_name: e.repo_name,
          title: e.title,
          url: e.url,
          github_username: e.github_username,
          event_at: e.event_at,
          additions: e.additions || null,
          deletions: e.deletions || null,
          changed_files: e.changed_files || null,
          review_state: e.review_state || null,
          metadata: e.metadata || {},
        }))

        // Upsert in batches of 50
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50)
          await step.run(`upsert-batch-${i}`, async () => {
            const { error } = await supabase
              .from('github_events')
              .upsert(batch, { onConflict: 'user_id,github_id,event_type' })
            if (error) console.error('[sync-github] Upsert error:', error)
          })
        }

        totalEvents = allEvents.length
      }

      // ── 5. Backfill line stats on historical PR events ──
      // The search API above only returns PRs *updated* in the sync window,
      // so older merged PRs (esp. those synced before hydration shipped)
      // can have NULL additions/deletions forever. This step finds some of
      // them and fills them in — bounded by MAX_PR_BACKFILLS to keep rate
      // usage predictable. Over repeated daily syncs, history drains.
      const backfilled = await step.run('backfill-pr-stats', async () => {
        const { data: unhydrated } = await supabase
          .from('github_events')
          .select('repo_name, metadata')
          .eq('user_id', user_id)
          .eq('event_type', 'pr_merged')
          .is('additions', null)
          .order('event_at', { ascending: false })
          .limit(MAX_PR_BACKFILLS)

        if (!unhydrated?.length) return { backfilled: 0 }

        // Dedupe by PR key — the same PR may also have an unhydrated
        // pr_opened row; we'll update both from a single API call.
        const prKeys = new Set<string>()
        const targets: Array<{ repo: string; number: number }> = []
        for (const row of unhydrated) {
          const num = (row as any).metadata?.pr_number
          const repo = (row as any).repo_name
          if (!num || !repo) continue
          const key = `${repo}#${num}`
          if (prKeys.has(key)) continue
          prKeys.add(key)
          targets.push({ repo, number: num })
        }

        let filled = 0
        for (const t of targets) {
          try {
            const detail = await githubFetch(
              `${GITHUB_API}/repos/${t.repo}/pulls/${t.number}`,
              token
            )
            const stats = {
              additions: Number.isFinite(detail.additions) ? detail.additions : 0,
              deletions: Number.isFinite(detail.deletions) ? detail.deletions : 0,
              changed_files: Number.isFinite(detail.changed_files) ? detail.changed_files : 0,
            }

            // Also capture AI signature from the PR title + body so the
            // backfill drains both gaps (line stats AND AI authorship) in
            // a single pass. Backfilled events were likely synced before
            // this feature existed and have neither.
            const sig = mergeAiSignatures(
              detectAiSignature(detail.title),
              detectAiSignature(detail.body)
            )

            // We can't patch jsonb keys in a single SQL update across rows
            // without a read-modify-write, so do it in two steps: first the
            // stats columns, then the metadata for each matching event.
            const { error } = await supabase
              .from('github_events')
              .update(stats)
              .eq('user_id', user_id)
              .eq('repo_name', t.repo)
              .in('event_type', ['pr_opened', 'pr_merged'])
              .filter('metadata->>pr_number', 'eq', String(t.number))

            if (!error) {
              // Merge ai_assisted / ai_tool into each matching row's metadata.
              const { data: matches } = await supabase
                .from('github_events')
                .select('id, metadata')
                .eq('user_id', user_id)
                .eq('repo_name', t.repo)
                .in('event_type', ['pr_opened', 'pr_merged'])
                .filter('metadata->>pr_number', 'eq', String(t.number))

              for (const m of matches || []) {
                const merged = {
                  ...((m as any).metadata || {}),
                  ai_assisted: sig.ai_assisted,
                  ai_tool: sig.tool,
                }
                await supabase
                  .from('github_events')
                  .update({ metadata: merged })
                  .eq('id', (m as any).id)
              }
            }
            if (error) {
              console.warn(`[sync-github] Backfill update failed for ${t.repo}#${t.number}:`, error.message)
              continue
            }
            filled++
          } catch (err: any) {
            // Private/archived/deleted PRs — skip and move on.
            console.warn(`[sync-github] Backfill fetch failed for ${t.repo}#${t.number}:`, err?.message)
          }
        }

        return { backfilled: filled, considered: targets.length }
      })

      // Update sync cursor
      await supabase
        .from('github_sync_cursors')
        .update({
          sync_status: 'idle',
          last_synced_at: new Date().toISOString(),
          events_synced: totalEvents,
          sync_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user_id)

      return { synced: totalEvents, commits: commits.length, prs: prsAuthored.length, reviews: reviews.length }
    } catch (err: any) {
      console.error('[sync-github] Sync error:', err)

      await supabase
        .from('github_sync_cursors')
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

export const syncGithubDaily = inngest.createFunction(
  {
    id: 'sync-github-daily',
    name: 'Daily GitHub Sync',
  },
  { cron: '0 6 * * *' },  // 6 AM UTC daily
  async ({ step }) => {
    const supabase = getAdminClient()

    // Find all users with active GitHub integrations
    const { data: integrations } = await supabase
      .from('integrations')
      .select('user_id, team_id, config')
      .eq('provider', 'github')

    if (!integrations?.length) return { message: 'No GitHub integrations to sync' }

    // Fan out: trigger individual syncs
    const events = integrations.map(int => ({
      name: 'github/sync.events' as const,
      data: {
        user_id: int.user_id,
        team_id: int.team_id,
        organization_id: null,
        github_username: int.config?.github_username,
        is_initial_sync: false,
      },
    }))

    await step.run('fan-out-syncs', async () => {
      await inngest.send(events)
    })

    return { triggered: events.length }
  }
)
