import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    // Try server-side session first
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch {
      // Server-side session failed — try userId from body
    }

    // Fallback: accept userId from request body (validated by checking profile exists)
    if (!userId) {
      try {
        const body = await request.json()
        if (body?.userId) {
          // Validate this userId exists in auth
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(body.userId)
          if (authUser?.user) {
            userId = authUser.user.id
          }
        }
      } catch {
        // No body or invalid body
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ensure the onboarding_completed column exists
    await ensureOnboardingColumns()

    // Mark onboarding as completed
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        onboarding_completed: true,
        onboarding_step: 'complete',
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) {
      console.error('Onboarding complete update failed:', error)
      return NextResponse.json(
        { error: 'Failed to mark onboarding complete: ' + error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Complete onboarding error:', err)
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Ensure the onboarding tracking columns exist on the profiles table.
 * This handles the case where migration 009 hasn't been applied.
 */
async function ensureOnboardingColumns() {
  try {
    // Test if the column exists by selecting it
    const { error } = await supabaseAdmin
      .from('profiles')
      .select('onboarding_completed')
      .limit(1)

    if (error && error.message?.includes('onboarding_completed')) {
      // Column doesn't exist — create it via raw SQL
      await supabaseAdmin.rpc('exec_sql', {
        sql: `
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
          ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_step TEXT;
        `,
      })
    }
  } catch {
    // If rpc doesn't exist either, we can't auto-migrate.
    // Log but don't block — the update will fail with a clear error.
    console.warn('Could not ensure onboarding columns exist. Migration 009 may need to be applied manually.')
  }
}
