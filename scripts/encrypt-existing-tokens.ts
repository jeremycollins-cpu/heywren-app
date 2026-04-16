#!/usr/bin/env npx tsx
/**
 * Backfill script: encrypt existing plaintext OAuth tokens in the
 * `integrations` table into the new encrypted_* columns.
 *
 * Prerequisites:
 *   1. Migration 072 has been applied (encrypted columns exist).
 *   2. INTEGRATION_TOKEN_ENCRYPTION_KEY is set in the environment.
 *   3. SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are set.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-tokens.ts
 *
 * The script is idempotent — rows that already have encrypted values are
 * skipped. It processes rows in batches of 100 with a small delay to avoid
 * hammering the database.
 *
 * IMPORTANT: After verifying the backfill is complete (all rows have
 * encrypted_access_token populated), schedule a follow-up migration to:
 *   - DROP COLUMN access_token
 *   - DROP COLUMN refresh_token
 *   - ALTER COLUMN encrypted_access_token SET NOT NULL
 * Do NOT drop the plaintext columns until the backfill is confirmed and all
 * application code has been updated to read from the encrypted columns.
 */

import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '../lib/crypto/integration-tokens'

const BATCH_SIZE = 100
const BATCH_DELAY_MS = 200

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(1)
  }

  if (!process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY) {
    console.error(
      'INTEGRATION_TOKEN_ENCRYPTION_KEY must be set before running the backfill. ' +
        'Generate one with: openssl rand -hex 32'
    )
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let totalProcessed = 0
  let totalSkipped = 0
  let totalErrors = 0
  let offset = 0

  console.log('Starting token encryption backfill...\n')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Fetch rows that still have a plaintext access_token but no encrypted version yet.
    const { data: rows, error } = await supabase
      .from('integrations')
      .select('id, access_token, refresh_token, encrypted_access_token')
      .is('encrypted_access_token', null)
      .not('access_token', 'is', null)
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.error('Error fetching integrations:', error.message)
      process.exit(1)
    }

    if (!rows || rows.length === 0) {
      break
    }

    for (const row of rows) {
      try {
        const updates: Record<string, string | null> = {}

        // Encrypt access token
        if (row.access_token) {
          const enc = encryptToken(row.access_token)
          updates.encrypted_access_token = enc.ciphertext
          updates.access_token_iv = enc.iv
          updates.access_token_tag = enc.tag
        }

        // Encrypt refresh token (may be null)
        if (row.refresh_token) {
          const enc = encryptToken(row.refresh_token)
          updates.encrypted_refresh_token = enc.ciphertext
          updates.refresh_token_iv = enc.iv
          updates.refresh_token_tag = enc.tag
        }

        if (Object.keys(updates).length === 0) {
          totalSkipped++
          continue
        }

        const { error: updateError } = await supabase
          .from('integrations')
          .update(updates)
          .eq('id', row.id)

        if (updateError) {
          console.error(`  Error updating row ${row.id}:`, updateError.message)
          totalErrors++
        } else {
          totalProcessed++
        }
      } catch (err) {
        console.error(`  Unexpected error on row ${row.id}:`, err)
        totalErrors++
      }
    }

    console.log(
      `  Batch processed: ${rows.length} rows (offset ${offset}), ` +
        `${totalProcessed} encrypted, ${totalSkipped} skipped, ${totalErrors} errors`
    )

    // If we got fewer rows than the batch size, we've reached the end.
    if (rows.length < BATCH_SIZE) {
      break
    }

    offset += BATCH_SIZE

    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
  }

  console.log('\nBackfill complete.')
  console.log(`  Total encrypted: ${totalProcessed}`)
  console.log(`  Total skipped:   ${totalSkipped}`)
  console.log(`  Total errors:    ${totalErrors}`)

  if (totalErrors > 0) {
    console.error('\nSome rows failed — re-run the script to retry.')
    process.exit(1)
  }

  console.log(
    '\nNext steps:\n' +
      '  1. Verify all rows have encrypted_access_token populated.\n' +
      '  2. Update application code to read from encrypted columns.\n' +
      '  3. Create a migration to DROP the plaintext access_token and refresh_token columns.'
  )
}

main()
