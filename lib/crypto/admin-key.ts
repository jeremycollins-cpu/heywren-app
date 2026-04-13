// AES-256-GCM helper for the Anthropic Admin API key at rest.
//
// The encryption key lives in ANTHROPIC_ADMIN_ENCRYPTION_KEY as a 64-char
// hex string (32 bytes). Generate one locally with:
//   openssl rand -hex 32
// Then set it in Vercel project env vars (Production + Preview + Development).
//
// Ciphertext, IV, and auth tag are all stored base64-encoded in separate
// columns. Never log any of them.

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96 bits, recommended for GCM

function getEncryptionKey(): Buffer {
  const hex = process.env.ANTHROPIC_ADMIN_ENCRYPTION_KEY
  if (!hex) {
    throw new Error(
      'ANTHROPIC_ADMIN_ENCRYPTION_KEY env var is not set. Generate with `openssl rand -hex 32` and add to Vercel.'
    )
  }
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 32) {
    throw new Error(
      `ANTHROPIC_ADMIN_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Got ${buf.length} bytes.`
    )
  }
  return buf
}

export function encryptAdminKey(plaintext: string): {
  ciphertext: string
  iv: string
  tag: string
} {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
}

export function decryptAdminKey(ciphertext: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

/**
 * Fingerprint of the raw admin key — SHA-256, first 8 hex chars. Safe to
 * store and display alongside the row to confirm identity ("key ending
 * ab12c3d4") without decrypting. Collisions are possible but not useful
 * to an attacker.
 */
export function fingerprintAdminKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex').slice(0, 8)
}
