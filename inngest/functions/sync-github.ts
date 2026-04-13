// inngest/functions/sync-github.ts
// Syncs GitHub activity (commits, PRs opened/merged/reviewed) for a user.
// Triggered on initial connect and then on a daily cron schedule.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectAiSignature, detectAiSignatureFromBranch, mergeAiSignatures } from '@/lib/github/ai-signature'

const GITHUB_API = 'https://api.github.com'
const MAX_PAGES = 10
const PER_PAGE = 100
// How far back to look on initial sync (90 days)
const INITIAL_SYNC_DAYS = 90
// Safety cap on per-PR stat hydration calls per sync run.
// Protects against runaway rate-limit usage for unusually active users.
const MAX_PR_HYDRATIONS = 100
// Budget for backfilling stats + AI signatures on historical PR events
// that were synced before detection shipped. Each daily sync chips away at
// the backlog until it's drained. 200 × ~200ms/call = ~40s per sync, well
// inside both Inngest step timeouts and GitHub's 5000/hr rate limit.
const MAX_PR_BACKFILLS = 200

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

      // ── 2b. Hydrate line-count stats + branch-based AI signal ──
      // The search API doesn't return additions/deletions/changed_files or
      // head.ref, so we fetch the PR detail endpoint once per PR and apply
      // the numbers + branch-based AI signature upgrade to all lifecycle
      // events (opened + merged). One API call per PR.
      await step.run('hydrate-pr-stats', async () => {
        type Hydrated = {
          additions: number
          deletions: number
          changed_files: number
          head_ref: string | null
          branchSig: ReturnType<typeof detectAiSignatureFromBranch>
        }
        const detailsByKey = new Map<string, Hydrated>()
        const seen = new Set<string>()

        for (const ev of prsAuthored) {
          const num = ev.metadata?.pr_number
          if (!num) continue
          const key = `${ev.repo_name}#${num}`
          if (seen.has(key)) continue
          seen.add(key)

          if (detailsByKey.size >= MAX_PR_HYDRATIONS) break

          try {
            const detail = await githubFetch(
              `${GITHUB_API}/repos/${ev.repo_name}/pulls/${num}`,
              token
            )
            detailsByKey.set(key, {
              additions: Number.isFinite(detail.additions) ? detail.additions : 0,
              deletions: Number.isFinite(detail.deletions) ? detail.deletions : 0,
              changed_files: Number.isFinite(detail.changed_files) ? detail.changed_files : 0,
              head_ref: detail.head?.ref ?? null,
              branchSig: detectAiSignatureFromBranch(detail.head?.ref),
            })
          } catch (err: any) {
            console.warn(`[sync-github] Stat hydration failed for ${key}:`, err?.message)
          }
        }

        // Apply stats + branch-derived AI signal in-place. If the title/body
        // pass already detected a tool, keep it (more specific than a branch
        // heuristic). Otherwise, adopt the branch-based result.
        for (const ev of prsAuthored) {
          const key = `${ev.repo_name}#${ev.metadata?.pr_number}`
          const d = detailsByKey.get(key)
          if (!d) continue
          ev.additions = d.additions
          ev.deletions = d.deletions
          ev.changed_files = d.changed_files
          if (ev.metadata) {
            ev.metadata.head_ref = d.head_ref
            const existingAi = Boolean(ev.metadata.ai_assisted)
            if (!existingAi && d.branchSig.ai_assisted) {
              ev.metadata.ai_assisted = true
              ev.metadata.ai_tool = d.branchSig.tool
            }
          }
        }

        return { hydrated: detailsByKey.size }
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

      // ── 5. Backfill PR metadata on historical events ──
      // The search API above only returns PRs *updated* in the sync window,
      // so older merged PRs can have NULL stats AND/OR missing AI-signature
      // metadata forever. This step finds PRs missing EITHER piece (stats
      // OR signature) and fills them in — bounded by MAX_PR_BACKFILLS to
      // keep rate usage predictable. Over repeated daily syncs, history
      // drains. One API call hydrates both stats and signature plus the
      // branch-prefix signal (head.ref).
      const backfilled = await step.run('backfill-pr-stats', async () => {
        // Two queries unioned in memory: rows missing additions, and rows
        // missing the ai_assisted metadata key. Supabase/PostgREST doesn't
        // support "IS NULL on jsonb key" in the client DSL cleanly, so we
        // use the `metadata->>ai_assisted.is.null` filter.
        const [missingStats, missingSig] = await Promise.all([
          supabase
            .from('github_events')
            .select('repo_name, metadata')
            .eq('user_id', user_id)
            .eq('event_type', 'pr_merged')
            .is('additions', null)
            .order('event_at', { ascending: false })
            .limit(MAX_PR_BACKFILLS),
          supabase
            .from('github_events')
            .select('repo_name, metadata')
            .eq('user_id', user_id)
            .eq('event_type', 'pr_merged')
            .is('metadata->>ai_assisted', null)
            .order('event_at', { ascending: false })
            .limit(MAX_PR_BACKFILLS),
        ])

        const unhydrated = [...(missingStats.data || []), ...(missingSig.data || [])]
        if (!unhydrated.length) return { backfilled: 0 }

        // Dedupe by PR key — a PR may appear in both queries (unhydrated on
        // both fronts) or the same PR may also have an unhydrated pr_opened
        // row. We'll update every matching row from a single API call.
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
          if (targets.length >= MAX_PR_BACKFILLS) break
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

            // Three-way AI detection: title + body (content signatures) and
            // head.ref (branch-prefix signal). A `claude/…` branch is
            // definitively Claude Code — the tool picked the name, no
            // human typed it.
            const sig = mergeAiSignatures(
              detectAiSignature(detail.title),
              detectAiSignature(detail.body),
              detectAiSignatureFromBranch(detail.head?.ref)
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
                  head_ref: detail.head?.ref ?? null,
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
