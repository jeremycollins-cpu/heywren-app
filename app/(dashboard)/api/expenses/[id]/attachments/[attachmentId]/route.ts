// app/(dashboard)/api/expenses/[id]/attachments/[attachmentId]/route.ts
// GET — stream the attachment binary back to the browser so the user can
// download a receipt PDF/image directly from HeyWren.
//
// Microsoft Graph returns attachment bodies as base64-encoded contentBytes;
// we decode here and respond with the original bytes + a sanitized filename
// so the browser triggers a normal Save dialog.

import { createClient } from '@/lib/supabase/server'
import {
  getOutlookIntegration,
  downloadMessageAttachment,
} from '@/lib/outlook/graph-client'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Strip filesystem-unsafe characters so the Content-Disposition filename
// doesn't break the response or let an attacker inject CRLF.
function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"\\/]/g, '_').slice(0, 255) || 'attachment'
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string; attachmentId: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { data: expense, error } = await supabase
      .from('expense_emails')
      .select('id, message_id, team_id, user_id')
      .eq('id', params.id)
      .single()

    if (error || !expense) {
      return new Response('Expense not found', { status: 404 })
    }

    const integration = await getOutlookIntegration(expense.team_id, expense.user_id)
    if (!integration) {
      return new Response('Outlook integration not connected', { status: 400 })
    }

    const admin = getAdminClient()
    const { attachment, error: graphError } = await downloadMessageAttachment(
      expense.message_id,
      params.attachmentId,
      integration.access_token,
      {
        supabase: admin,
        integrationId: integration.id,
        refreshToken: integration.refresh_token,
      }
    )

    if (graphError || !attachment?.contentBytes) {
      return new Response(graphError || 'Attachment unavailable', { status: 502 })
    }

    const bytes = Buffer.from(attachment.contentBytes, 'base64')
    const safeName = sanitizeFilename(attachment.name)

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': attachment.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[api/expenses/[id]/attachments/[attachmentId]] error:', err)
    return new Response('Internal error', { status: 500 })
  }
}
