import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Self-contained RFC 6238 TOTP (and its RFC 4226 HOTP core) so two-factor auth
 * needs no third-party dependency. Secrets are base32 (the format Google
 * Authenticator / 1Password / Authy expect in an otpauth:// URI); codes are the
 * usual 6 digits on a 30-second step, verified with a ±1 step window to absorb
 * clock skew between the server and the user's phone.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

/** A fresh 20-byte (160-bit) secret, base32-encoded without padding. */
export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  // Big-endian 64-bit counter (high word is 0 well past the year 10000).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** The code for a given time (defaults to now); exposed for tests/enrollment. */
export function totpCodeAt(secret: string, at: number = Date.now()): string {
  return hotp(secret, Math.floor(at / 1000 / STEP_SECONDS));
}

/** Constant-time verify with a ±1 step window. */
export function verifyTotp(
  secret: string,
  code: string,
  at: number = Date.now(),
): boolean {
  const trimmed = (code ?? '').trim();
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  for (let window = -1; window <= 1; window++) {
    const expected = hotp(secret, counter + window);
    const a = Buffer.from(expected);
    const b = Buffer.from(trimmed);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** otpauth:// URI an authenticator app turns into a QR code. */
export function otpauthUri(
  secret: string,
  accountName: string,
  issuer = 'Cloud Ops Tool',
): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
