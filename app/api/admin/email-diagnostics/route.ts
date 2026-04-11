import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function checkSuperAdmin(): Promise<boolean> {
  const supabase = await createServerClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return false

  const adminDb = getAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single()

  return profile?.role === 'super_admin'
}

export async function GET() {
  if (!(await checkSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const adminDb = getAdminClient()
  const results: Record<string, any> = {}

  // 1. Check environment variables (existence only, not values)
  results.envVars = {
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    INNGEST_SIGNING_KEY: !!process.env.INNGEST_SIGNING_KEY,
    INNGEST_EVENT_KEY: !!process.env.INNGEST_EVENT_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || '(not set)',
  }

  // 2. Test Resend connectivity
  try {
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      // Fetch domains to verify the key works without sending an email
      const { data, error } = await resend.domains.list()
      if (error) {
        results.resend = { connected: false, error: error.message }
      } else {
        results.resend = {
          connected: true,
          domains: (data?.data || []).map((d: any) => ({
            name: d.name,
            status: d.status,
          })),
        }
      }
    } else {
      results.resend = { connected: false, error: 'RESEND_API_KEY not configured' }
    }
  } catch (err) {
    results.resend = { connected: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }

  // 3. Recent email_sends summary (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  try {
    const { data: recentSends, error: sendsError } = await adminDb
      .from('email_sends')
      .select('email_type, status, created_at, recipient, subject, error')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50)

    if (sendsError) {
      results.recentSends = { error: sendsError.message }
    } else {
      const sends = recentSends || []
      const sent = sends.filter((s: any) => s.status === 'sent').length
      const failed = sends.filter((s: any) => s.status === 'failed').length

      results.recentSends = {
        total: sends.length,
        sent,
        failed,
        entries: sends.map((s: any) => ({
          type: s.email_type,
          status: s.status,
          recipient: s.recipient,
          subject: s.subject,
          error: s.error || null,
          created_at: s.created_at,
        })),
      }
    }
  } catch (err) {
    results.recentSends = { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  // 4. Count total email_sends ever (to see if the system has ever sent anything)
  try {
    const { count, error: countError } = await adminDb
      .from('email_sends')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      results.totalSends = { error: countError.message }
    } else {
      results.totalSends = count || 0
    }
  } catch (err) {
    results.totalSends = { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  // 5. Check welcome_drip_state to see if drip sequence is running
  try {
    const { data: dripStates, error: dripError } = await adminDb
      .from('welcome_drip_state')
      .select('user_id, d0_sent_at, d1_sent_at, d3_sent_at, d7_sent_at')
      .order('d0_sent_at', { ascending: false })
      .limit(10)

    if (dripError) {
      results.welcomeDrip = { error: dripError.message }
    } else {
      results.welcomeDrip = {
        totalTracked: (dripStates || []).length,
        recent: (dripStates || []).map((d: any) => ({
          user_id: d.user_id?.slice(0, 8) + '...',
          d0: d.d0_sent_at ? 'sent' : 'pending',
          d1: d.d1_sent_at ? 'sent' : 'pending',
          d3: d.d3_sent_at ? 'sent' : 'pending',
          d7: d.d7_sent_at ? 'sent' : 'pending',
        })),
      }
    }
  } catch {
    results.welcomeDrip = { error: 'Table may not exist yet' }
  }

  // 6. Check notification_preferences for any users that have opted out
  try {
    const { data: prefs, error: prefsError } = await adminDb
      .from('notification_preferences')
      .select('email_weekly_recap, email_nudges, email_achievements, email_manager_briefing, email_reengagement')

    if (prefsError) {
      results.preferences = { error: prefsError.message }
    } else {
      const all = prefs || []
      results.preferences = {
        totalUsers: all.length,
        optedOut: {
          weekly_recap: all.filter((p: any) => p.email_weekly_recap === false).length,
          nudges: all.filter((p: any) => p.email_nudges === false).length,
          achievements: all.filter((p: any) => p.email_achievements === false).length,
          manager_briefing: all.filter((p: any) => p.email_manager_briefing === false).length,
          reengagement: all.filter((p: any) => p.email_reengagement === false).length,
        },
      }
    }
  } catch {
    results.preferences = { error: 'Table may not exist yet' }
  }

  return NextResponse.json(results)
}
