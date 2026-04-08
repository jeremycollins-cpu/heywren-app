// app/(dashboard)/api/email-rules/route.ts
// GET: List user's email organization rules
// POST: Create a rule (move emails + create Outlook inbox rule)
// PATCH: Update a rule (enable/disable, change folder)
// DELETE: Remove a rule (delete from Outlook + local)

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import {
  getOutlookIntegration,
  createInboxRule,
  deleteInboxRule,
  updateInboxRule,
  moveMessage,
} from '@/lib/outlook/graph-client'
import { inngest } from '@/inngest/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const { data: rules, error } = await admin
      .from('email_rules')
      .select('*')
      .eq('team_id', profile.current_team_id)
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to fetch email rules:', error)
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }

    // Aggregate stats
    const totalRules = (rules || []).filter(r => r.sync_status !== 'disabled').length
    const totalMoved = (rules || []).reduce((sum, r) => sum + (r.emails_moved || 0), 0)

    return NextResponse.json({
      rules: rules || [],
      stats: { totalRules, totalMoved },
    })
  } catch (err) {
    console.error('Email rules GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      matchType,
      matchValue,
      targetFolderId,
      targetFolderName,
      markAsRead = false,
      applyToExisting = false,
      sourceEmailIds = [],
    } = body

    // Validate
    if (!matchType || !matchValue || !targetFolderId || !targetFolderName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!['from_email', 'from_domain', 'subject_contains'].includes(matchType)) {
      return NextResponse.json({ error: 'Invalid matchType' }, { status: 400 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const teamId = profile.current_team_id
    const userId = userData.user.id

    const integration = await getOutlookIntegration(teamId, userId)
    if (!integration) {
      return NextResponse.json({ error: 'Outlook not connected' }, { status: 400 })
    }

    const ctx = {
      supabase: admin,
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    // 1. Move the specific source emails immediately
    let movedCount = 0
    let currentToken = integration.access_token
    for (const msgId of sourceEmailIds) {
      const { success, token } = await moveMessage(msgId, targetFolderId, currentToken, ctx)
      currentToken = token
      if (success) movedCount++
    }

    // 2. Create Outlook inbox rule
    let outlookRuleId: string | null = null
    let syncStatus = 'pending'
    let syncError: string | null = null

    const { rule, token: ruleToken, error: ruleError } = await createInboxRule(
      { matchType, matchValue, targetFolderId, markAsRead },
      currentToken,
      ctx
    )
    currentToken = ruleToken

    if (rule) {
      outlookRuleId = rule.id
      syncStatus = 'synced'
    } else {
      syncError = ruleError || 'Failed to create Outlook rule'
      syncStatus = 'failed'
    }

    // 3. Store rule locally
    const now = new Date().toISOString()
    const { data: savedRule, error: insertError } = await admin
      .from('email_rules')
      .upsert(
        {
          team_id: teamId,
          user_id: userId,
          match_type: matchType,
          match_value: matchValue,
          target_folder_id: targetFolderId,
          target_folder_name: targetFolderName,
          mark_as_read: markAsRead,
          outlook_rule_id: outlookRuleId,
          sync_status: syncStatus,
          sync_error: syncError,
          last_synced_at: syncStatus === 'synced' ? now : null,
          emails_moved: movedCount,
          last_applied_at: movedCount > 0 ? now : null,
          updated_at: now,
        },
        { onConflict: 'team_id,user_id,match_type,match_value' }
      )
      .select()
      .single()

    if (insertError) {
      console.error('Failed to store email rule:', insertError)
      return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 })
    }

    // 4. If applyToExisting, send Inngest event for background processing
    if (applyToExisting && savedRule) {
      await inngest.send({
        name: 'email-rule/apply-existing',
        data: {
          ruleId: savedRule.id,
          teamId,
          userId,
          matchType,
          matchValue,
          targetFolderId,
        },
      })
    }

    return NextResponse.json({
      rule: savedRule,
      movedCount,
      syncStatus,
      syncError,
    })
  } catch (err) {
    console.error('Email rules POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ruleId, action } = await request.json()
    if (!ruleId || !['enable', 'disable'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Verify ownership
    const { data: rule } = await admin
      .from('email_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('user_id', userData.user.id)
      .single()

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Update Outlook rule if synced
    if (rule.outlook_rule_id) {
      const { data: profile } = await admin
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      const integration = await getOutlookIntegration(profile!.current_team_id, userData.user.id)
      if (integration) {
        const ctx = {
          supabase: admin,
          integrationId: integration.id,
          refreshToken: integration.refresh_token,
        }
        await updateInboxRule(
          rule.outlook_rule_id,
          { isEnabled: action === 'enable' },
          integration.access_token,
          ctx
        )
      }
    }

    // Update local
    await admin
      .from('email_rules')
      .update({
        sync_status: action === 'enable' ? 'synced' : 'disabled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ruleId)

    return NextResponse.json({ success: true, status: action === 'enable' ? 'synced' : 'disabled' })
  } catch (err) {
    console.error('Email rules PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ruleId } = await request.json()
    if (!ruleId) {
      return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 })
    }

    const admin = getAdminClient()

    // Verify ownership
    const { data: rule } = await admin
      .from('email_rules')
      .select('*')
      .eq('id', ruleId)
      .eq('user_id', userData.user.id)
      .single()

    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    // Delete from Outlook if synced
    if (rule.outlook_rule_id) {
      const { data: profile } = await admin
        .from('profiles')
        .select('current_team_id')
        .eq('id', userData.user.id)
        .single()

      const integration = await getOutlookIntegration(profile!.current_team_id, userData.user.id)
      if (integration) {
        const ctx = {
          supabase: admin,
          integrationId: integration.id,
          refreshToken: integration.refresh_token,
        }
        await deleteInboxRule(rule.outlook_rule_id, integration.access_token, ctx)
      }
    }

    // Delete local
    await admin.from('email_rules').delete().eq('id', ruleId)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Email rules DELETE error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
