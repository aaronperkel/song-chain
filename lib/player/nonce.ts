/**
 * A random suffix for a pick nonce.
 *
 * `crypto.randomUUID` is restricted to secure contexts, so it is `undefined`
 * on a phone loading this app over plain http — which is every guest phone
 * during a LAN playtest, and the exact device this game is built for.
 * `crypto.getRandomValues` carries no such restriction. The last resort is
 * weaker but keeps the button working: a collision costs one merged pick,
 * whereas a throw costs the whole turn.
 *
 * Uniqueness only has to hold within a single room, so 96 bits is ample.
 */
export function randomToken(): string {
  const bytes = new Uint8Array(12)
  const webcrypto: Crypto | undefined = globalThis.crypto
  if (typeof webcrypto?.getRandomValues === 'function') {
    webcrypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
