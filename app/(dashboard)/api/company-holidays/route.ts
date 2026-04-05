import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/company-holidays
 * Returns company holidays for the caller's org. All members can view.
 * ?year=2026 — filter to a specific year (default: current year)
 */
export async function GET(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { searchParams } = new URL(request.url)
    const year = searchParams.get('year') || new Date().getFullYear().toString()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const { data: holidays } = await admin
      .from('company_holidays')
      .select('id, name, date, recurring, created_at')
      .eq('organization_id', membership.organization_id)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: true })

    return NextResponse.json({
      holidays: holidays || [],
      isAdmin: membership.role === 'org_admin',
    })
  } catch (err) {
    console.error('Company holidays GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

/**
 * POST /api/company-holidays
 * Add a company holiday. Org admins only.
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can manage holidays' }, { status: 403 })
    }

    const body = await request.json()
    const { name, date, recurring } = body as {
      name: string
      date: string
      recurring?: boolean
    }

    if (!name?.trim() || !date) {
      return NextResponse.json({ error: 'Name and date are required' }, { status: 400 })
    }

    const { data: holiday, error } = await admin
      .from('company_holidays')
      .insert({
        organization_id: membership.organization_id,
        name: name.trim(),
        date,
        recurring: recurring || false,
        created_by: callerId,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A holiday already exists on that date' }, { status: 409 })
      }
      console.error('Company holidays insert error:', error)
      return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
    }

    return NextResponse.json({ holiday })
  } catch (err) {
    console.error('Company holidays POST error:', err)
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  }
}

/**
 * DELETE /api/company-holidays
 * Remove a company holiday. Org admins only.
 */
export async function DELETE(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()

    const { data: membership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!membership || membership.role !== 'org_admin') {
      return NextResponse.json({ error: 'Only org admins can manage holidays' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing holiday id' }, { status: 400 })
    }

    const { error } = await admin
      .from('company_holidays')
      .delete()
      .eq('id', id)
      .eq('organization_id', membership.organization_id)

    if (error) {
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Company holidays DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
