// AES-256-GCM helper for OAuth integration tokens (access_token, refresh_token)
// stored in the `integrations` table.
//
// The encryption key lives in INTEGRATION_TOKEN_ENCRYPTION_KEY as a 64-char
// hex string (32 bytes). Generate one locally with:
//   openssl rand -hex 32
// Then set it in Vercel project env vars (Production + Preview + Development).
//
// Unlike the admin-key module, this module has a **migration-period fallback**:
// if INTEGRATION_TOKEN_ENCRYPTION_KEY is not set, encryptToken returns the
// plaintext unchanged and decryptToken returns ciphertext as-is. This lets
// the app keep running while you roll out the key and backfill existing rows.

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits, recommended for GCM

let warnedOnce = false

function getEncryptionKey(): Buffer | null {
  const hex = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY
  if (!hex) {
    if (!warnedOnce) {
      console.warn(
        '[integration-tokens] INTEGRATION_TOKEN_ENCRYPTION_KEY is not set. ' +
          'Tokens will be stored/read as plaintext. Set the key and run the ' +
          'backfill script to enable encryption at rest.'
      )
      warnedOnce = true
    }
    return null
  }
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 32) {
    throw new Error(
      `INTEGRATION_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Got ${buf.length} bytes.`
    )
  }
  return buf
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 *
 * If INTEGRATION_TOKEN_ENCRYPTION_KEY is not configured, returns the plaintext
 * in the `ciphertext` field with empty `iv` and `tag` (migration-period
 * fallback). Callers should store all three columns regardless.
 */
export function encryptToken(plaintext: string): {
  ciphertext: string
  iv: string
  tag: string
} {
  const key = getEncryptionKey()
  if (!key) {
    // Fallback: store plaintext. iv/tag are empty strings so we can detect
    // unencrypted rows during the backfill.
    return { ciphertext: plaintext, iv: '', tag: '' }
  }

  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypt a token previously encrypted with `encryptToken`.
 *
 * If `iv` and `tag` are empty strings the value was stored in plaintext
 * (migration-period fallback) and is returned as-is.
 */
export function decryptToken(ciphertext: string, iv: string, tag: string): string {
  // If iv/tag are empty this row was stored before encryption was enabled.
  if (!iv && !tag) {
    return ciphertext
  }

  const key = getEncryptionKey()
  if (!key) {
    throw new Error(
      'INTEGRATION_TOKEN_ENCRYPTION_KEY is not set but the row has encrypted data ' +
        '(iv and tag are present). Set the key to decrypt.'
    )
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
