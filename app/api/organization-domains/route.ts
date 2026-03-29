import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET — fetch allowed domains for the user's organization
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find user's organization
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.organization_id) {
    return NextResponse.json({ domains: [], organizationId: null })
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('domain, allowed_domains')
    .eq('id', membership.organization_id)
    .single()

  const domains: string[] = []
  if (org?.domain) domains.push(org.domain)
  if (Array.isArray(org?.allowed_domains)) {
    for (const d of org.allowed_domains) {
      if (typeof d === 'string' && d && !domains.includes(d)) domains.push(d)
    }
  }

  return NextResponse.json({
    domains,
    organizationId: membership.organization_id,
    isAdmin: membership.role === 'org_admin',
  })
}

// PUT — update allowed domains (org_admin only)
export async function PUT(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domains } = await req.json() as { domains: string[] }
  if (!Array.isArray(domains)) {
    return NextResponse.json({ error: 'domains must be an array of strings' }, { status: 400 })
  }

  // Validate and normalize domains
  const cleanDomains = domains
    .map(d => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(d => d && d.includes('.'))

  // Find user's organization and check admin role
  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.organization_id) {
    return NextResponse.json({ error: 'No organization found' }, { status: 404 })
  }
  if (membership.role !== 'org_admin') {
    return NextResponse.json({ error: 'Only org admins can update domains' }, { status: 403 })
  }

  // Update: set primary domain to first entry, allowed_domains to all
  const primaryDomain = cleanDomains[0] || null
  const { error } = await supabase
    .from('organizations')
    .update({
      domain: primaryDomain,
      allowed_domains: cleanDomains,
    })
    .eq('id', membership.organization_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ domains: cleanDomains })
}
