// Browser/SW polyfill of Node's `crypto` module — the three surfaces GramJS
// uses via `telegram/CryptoFile.js`: `randomBytes`, `createHash`, and
// `pbkdf2Sync`. Mirrors the shape GramJS's own internal
// `telegram/crypto/crypto.js` browser implementation uses (digest()
// returns a Promise even though the Node `createHash().digest()` is sync —
// callers in GramJS already await).
import { Buffer } from 'buffer';

export function randomBytes(count) {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

class Hash {
  constructor(algorithm) {
    this.algorithm = algorithm;
    this.data = new Uint8Array(0);
  }
  update(data) {
    const buf = data instanceof Uint8Array ? data : Buffer.from(data);
    const next = new Uint8Array(this.data.length + buf.length);
    next.set(this.data, 0);
    next.set(buf, this.data.length);
    this.data = next;
    return this;
  }
  async digest() {
    const algo =
      this.algorithm === 'sha1'
        ? 'SHA-1'
        : this.algorithm === 'sha256'
          ? 'SHA-256'
          : this.algorithm === 'sha512'
            ? 'SHA-512'
            : (() => {
                throw new Error(`unsupported hash: ${this.algorithm}`);
              })();
    const digestBytes = await globalThis.crypto.subtle.digest(algo, this.data);
    return Buffer.from(digestBytes);
  }
}

export function createHash(algorithm) {
  return new Hash(algorithm);
}

export async function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  const hash =
    digest === 'sha512'
      ? 'SHA-512'
      : digest === 'sha256'
        ? 'SHA-256'
        : digest === 'sha1'
          ? 'SHA-1'
          : (() => {
              throw new Error(`unsupported pbkdf2 digest: ${digest}`);
            })();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    password,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash, salt, iterations },
    passwordKey,
    keylen * 8,
  );
  return Buffer.from(bits);
}

const cryptoShim = { randomBytes, createHash, pbkdf2Sync };
export default cryptoShim;
