// Encrypts secrets (users' AI keys) before storing them, with AES-256-GCM.
// Format: v1.<iv>.<auth tag>.<ciphertext>, each part base64url.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const VERSION = 'v1'

function getKey(): Buffer {
  const key = Buffer.from(requireEnv('AI_KEY_ENCRYPTION_SECRET'), 'base64')
  if (key.length !== 32) {
    throw new Error('AI_KEY_ENCRYPTION_SECRET must be 32 bytes, base64 encoded')
  }
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split('.')
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted secret format')
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
