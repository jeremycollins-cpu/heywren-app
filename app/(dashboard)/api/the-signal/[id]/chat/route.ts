// app/(dashboard)/api/monthly-briefing/[id]/chat/route.ts
// POST — chat-to-refine endpoint.
//   body: { message: string, targetSectionId?: string }
//   The AI may reply with a section update; the route applies it
//   atomically and returns both the assistant message and the new state.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { refineBriefingSection } from '@/lib/ai/refine-briefing-section'
import { logAiUsage } from '@/lib/ai/persist-usage'
import type {
  AggregatedDataSnapshot,
  BriefingMessage,
  BriefingSection,
} from '@/lib/monthly-briefing/types'

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface Body {
  message: string
  targetSectionId?: string | null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 })
  }

  const { data: briefing } = await supabase
    .from('monthly_briefings')
    .select('id, team_id, data_snapshot, status')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })
  if (briefing.status !== 'ready') {
    return NextResponse.json({ error: 'Briefing is still being generated.' }, { status: 409 })
  }

  const snapshot = briefing.data_snapshot as unknown as AggregatedDataSnapshot
  if (!snapshot || !snapshot.period) {
    return NextResponse.json({ error: 'Briefing has no data snapshot. Regenerate it first.' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Persist the user message immediately
  await admin.from('briefing_messages').insert({
    briefing_id: briefing.id,
    user_id: user.id,
    role: 'user',
    content: body.message,
    target_section_id: body.targetSectionId || null,
  })

  // Load current sections + recent history + target section
  const [{ data: sections }, { data: history }, { data: target }] = await Promise.all([
    admin.from('briefing_sections').select('*').eq('briefing_id', briefing.id).order('order_index'),
    admin.from('briefing_messages').select('*').eq('briefing_id', briefing.id).order('created_at', { ascending: false }).limit(10),
    body.targetSectionId
      ? admin.from('briefing_sections').select('*').eq('id', body.targetSectionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const result = await refineBriefingSection({
    snapshot,
    sections: (sections as BriefingSection[]) || [],
    history: (((history as BriefingMessage[]) || []).reverse()),
    userMessage: body.message,
    targetSection: (target?.data as BriefingSection) || null,
  })

  if (!result) {
    return NextResponse.json({ error: 'AI did not respond. Try again.' }, { status: 502 })
  }

  // Apply the action
  let updatedSection: BriefingSection | null = null
  let createdSectionId: string | null = null

  if (result.action === 'update_section' && result.section && result.targetSectionId) {
    const { data } = await admin
      .from('briefing_sections')
      .update({
        title: result.section.title,
        summary: result.section.summary,
        bullets: result.section.bullets,
        section_type: result.section.section_type,
        user_edited: true,
      })
      .eq('id', result.targetSectionId)
      .eq('briefing_id', briefing.id)
      .select('*')
      .single()
    updatedSection = (data as BriefingSection) || null
  } else if (result.action === 'add_section' && result.section) {
    // Append after the last section
    const { data: maxRow } = await admin
      .from('briefing_sections')
      .select('order_index')
      .eq('briefing_id', briefing.id)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = (maxRow?.order_index ?? -1) + 1
    const { data } = await admin
      .from('briefing_sections')
      .insert({
        briefing_id: briefing.id,
        section_type: result.section.section_type,
        title: result.section.title,
        summary: result.section.summary,
        bullets: result.section.bullets,
        order_index: nextOrder,
        user_edited: true,
      })
      .select('*')
      .single()
    updatedSection = (data as BriefingSection) || null
    createdSectionId = data?.id || null
  } else if (result.action === 'delete_section' && result.targetSectionId) {
    await admin
      .from('briefing_sections')
      .delete()
      .eq('id', result.targetSectionId)
      .eq('briefing_id', briefing.id)
  }

  // Persist assistant reply
  const { data: assistantMessage } = await admin
    .from('briefing_messages')
    .insert({
      briefing_id: briefing.id,
      user_id: user.id,
      role: 'assistant',
      content: result.reply,
      target_section_id: createdSectionId || result.targetSectionId || body.targetSectionId || null,
      action: { type: result.action, section_id: createdSectionId || result.targetSectionId || null },
    })
    .select('*')
    .single()

  await logAiUsage(admin, {
    module: 'refine-briefing-section',
    trigger: 'briefing/chat',
    teamId: briefing.team_id,
    userId: user.id,
    metadata: { briefingId: briefing.id, action: result.action },
  })

  return NextResponse.json({
    message: assistantMessage,
    action: result.action,
    section: updatedSection,
    deletedSectionId: result.action === 'delete_section' ? result.targetSectionId : null,
  })
}
