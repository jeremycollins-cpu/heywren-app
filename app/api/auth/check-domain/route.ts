// app/api/auth/check-domain/route.ts
// Checks if a team already exists for the given email domain
// Called during signup to enable auto-join flow

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role to bypass RLS — this is called before the user has a session
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Free/personal email domains that should never match a team
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'tutanota.com',
  'zoho.com', 'yandex.com', 'mail.com', 'gmx.com',
  'fastmail.com', 'hey.com', 'pm.me',
])

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
    }

    const domain = email.split('@')[1].toLowerCase()

    // Don't match personal email domains
    if (FREE_EMAIL_DOMAINS.has(domain)) {
      return NextResponse.json({
        teamExists: false,
        domain,
        isPersonalEmail: true,
      })
    }

    // Look for a team with this domain
    const { data: team, error } = await supabaseAdmin
      .from('teams')
      .select('id, name, domain')
      .eq('domain', domain)
      .limit(1)
      .single()

    if (error || !team) {
      return NextResponse.json({
        teamExists: false,
        domain,
        isPersonalEmail: false,
      })
    }

    // Count current team members (for display)
    const { count } = await supabaseAdmin
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('team_id', team.id)

    return NextResponse.json({
      teamExists: true,
      domain,
      isPersonalEmail: false,
      team: {
        id: team.id,
        name: team.name,
        memberCount: count || 1,
      },
    })
  } catch (error: any) {
    console.error('Check domain error:', error)
    return NextResponse.json(
      { error: 'Failed to check domain' },
      { status: 500 }
    )
  }
}
