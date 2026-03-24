import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id

    // Try full update with onboarding columns
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

      // If columns don't exist (migration 009 not applied), just update timestamp
      if (error.message?.includes('column') || error.code === '42703') {
        console.warn('Falling back: onboarding columns missing (run migration 009)')
        await supabaseAdmin
          .from('profiles')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', userId)
      }
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
