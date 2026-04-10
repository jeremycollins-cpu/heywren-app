export const dynamic = 'force-dynamic'

// app/api/recall/test/route.ts
// Diagnostic endpoint — tests the Recall.ai API connection directly (bypasses Inngest).
// DELETE THIS after debugging is complete.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { meeting_url } = body

    // Check env var
    const apiKey = process.env.RECALL_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        error: 'RECALL_API_KEY is not set in environment',
        env_check: {
          RECALL_API_KEY: '❌ MISSING',
          NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || '❌ MISSING',
        }
      }, { status: 500 })
    }

    // Call Recall.ai directly
    const recallBody = {
      meeting_url,
      bot_name: 'HeyWren Notetaker',
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {},
          },
          diarization: {
            use_separate_streams_when_available: true,
          },
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: `${process.env.NEXT_PUBLIC_APP_URL}/api/recall/webhook`,
            events: ['transcript.data'],
          },
        ],
      },
    }

    console.log('[recall-test] Calling Recall.ai with:', JSON.stringify(recallBody, null, 2))

    const res = await fetch('https://us-west-2.recall.ai/api/v1/bot/', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recallBody),
    })

    const responseText = await res.text()
    let responseJson: any = null
    try {
      responseJson = JSON.parse(responseText)
    } catch {
      // Not JSON
    }

    if (!res.ok) {
      return NextResponse.json({
        error: 'Recall.ai API call failed',
        status: res.status,
        statusText: res.statusText,
        response: responseJson || responseText,
        request_sent: recallBody,
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      message: 'Bot created successfully! It should join the meeting within 30 seconds.',
      bot: responseJson,
      request_sent: recallBody,
    })
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected error',
      message: (error as Error).message,
      stack: (error as Error).stack,
    }, { status: 500 })
  }
}
