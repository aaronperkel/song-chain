import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Authenticated encryption for the host's Spotify tokens at rest.
 *
 * A refresh token is a long-lived credential for someone's Spotify account. It
 * lives in a row in a hosted database, so it is encrypted with a key that
 * lives only in the server environment: a database leak alone yields nothing.
 *
 * AES-256-GCM, so the ciphertext is tamper-evident as well as unreadable --
 * `open` fails loudly rather than returning garbage.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
/** Bump if the format changes, so old values are still readable. */
const VERSION = 'v1'

export class SealError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SealError'
  }
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY
  if (raw === undefined || raw.length === 0) {
    throw new SealError(
      'TOKEN_ENC_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }

  const decoded = Buffer.from(raw, 'base64')
  if (decoded.length !== KEY_BYTES) {
    throw new SealError(
      `TOKEN_ENC_KEY must decode to ${String(KEY_BYTES)} bytes, got ${String(decoded.length)}`,
    )
  }
  return decoded
}

/**
 * Encrypt a secret for storage. Output is
 * `v1.<iv>.<ciphertext>.<tag>`, all base64url.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.')
}

/** Decrypt a sealed secret. Throws if it was tampered with or truncated. */
export function open(sealed: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4) {
    throw new SealError('Sealed value is malformed')
  }

  const [version, ivPart, ciphertextPart, tagPart] = parts as [string, string, string, string]
  if (version !== VERSION) {
    throw new SealError(`Unknown seal version "${version}"`)
  }

  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SealError('Sealed value is malformed')
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch (cause) {
    if (cause instanceof SealError) throw cause
    // GCM authentication failure: wrong key, or the value was edited.
    throw new SealError('Sealed value failed authentication', { cause })
  }
}

/** True if this looks like a sealed value, without trying to decrypt it. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split('.').length === 4
}

/**
 * A room's host token is a bearer secret handed to one browser. Only its hash
 * is stored, so the database never holds anything that grants host control.
 */
export function newHostSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

/** Constant-time comparison, so a wrong guess leaks no timing signal. */
export function secretMatches(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret))
  const expected = Buffer.from(expectedHash)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}
