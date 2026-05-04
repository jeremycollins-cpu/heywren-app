// app/(dashboard)/api/expenses/[id]/attachments/route.ts
// GET — list attachments on the underlying Outlook message for a given expense.
// We deliberately fetch live from Graph rather than persisting attachment
// metadata: receipts are usually small, attachment lists are ephemeral, and
// storing the bytes would be a privacy/storage liability for a feature that
// most users will only use a few times per month.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getOutlookIntegration,
  listMessageAttachments,
} from '@/lib/outlook/graph-client'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Look up the expense — RLS ensures the user can only see their own rows.
    const { data: expense, error } = await supabase
      .from('expense_emails')
      .select('id, message_id, team_id, user_id')
      .eq('id', params.id)
      .single()

    if (error || !expense) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    const integration = await getOutlookIntegration(expense.team_id, expense.user_id)
    if (!integration) {
      return NextResponse.json(
        { error: 'Outlook integration not connected' },
        { status: 400 }
      )
    }

    const admin = getAdminClient()
    const { attachments, error: graphError } = await listMessageAttachments(
      expense.message_id,
      integration.access_token,
      {
        supabase: admin,
        integrationId: integration.id,
        refreshToken: integration.refresh_token,
      }
    )

    if (graphError) {
      return NextResponse.json({ error: graphError, attachments: [] }, { status: 502 })
    }

    // Update cached counts so the list view shows the badge accurately
    if (attachments.length > 0) {
      await admin
        .from('expense_emails')
        .update({
          has_attachments: true,
          attachment_count: attachments.length,
        })
        .eq('id', expense.id)
    } else {
      await admin
        .from('expense_emails')
        .update({ has_attachments: false, attachment_count: 0 })
        .eq('id', expense.id)
    }

    return NextResponse.json({
      attachments: attachments.map(a => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
      })),
    })
  } catch (err) {
    console.error('[api/expenses/[id]/attachments] error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
