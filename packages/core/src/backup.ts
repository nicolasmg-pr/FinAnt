/**
 * Crockford base32. `I`, `L`, `O` and `U` are absent on purpose: the first
 * three are the ones a handwritten code gets transcribed wrong, and `U` is
 * left out so a random code cannot spell something unfortunate.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const GROUP = 5;
const GROUPS = 5;
const LENGTH = GROUP * GROUPS;

/**
 * The shape a recovery code must have before it is allowed anywhere near a
 * statement. `PRAGMA key` cannot be parameterised, so this pattern — not an
 * escaping routine — is what stands between a typed string and the database.
 */
export const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

/**
 * Renders 125 bits of the caller's randomness as a grouped code.
 *
 * The bytes come from the caller because this package stays free of Expo: the
 * device passes `Crypto.getRandomBytes(16)` in. Sixteen bytes carry 128 bits
 * and twenty-five base32 characters hold 125; the remaining three are dropped
 * rather than padded, because a code whose last character only ever takes four
 * of thirty-two values invites the reader to wonder why.
 */
export function formatRecoveryCode(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    throw new Error('a recovery code needs 16 random bytes');
  }

  let chars = '';
  let accumulator = 0;
  let bits = 0;
  for (let i = 0; i < 16 && chars.length < LENGTH; i += 1) {
    accumulator = (accumulator << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5 && chars.length < LENGTH) {
      bits -= 5;
      chars += ALPHABET.charAt((accumulator >>> bits) & 31);
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < LENGTH; i += GROUP) {
    groups.push(chars.slice(i, i + GROUP));
  }
  return groups.join('-');
}

/**
 * Puts a typed or pasted code into canonical form so that a correct code is
 * not rejected over casing, grouping or a transcription of `O` for `0`.
 *
 * It never *adds* validity: characters outside the alphabet are left in place
 * rather than stripped, so `isValidRecoveryCode` still sees them and still
 * refuses. Stripping would quietly turn a wrong code into a valid-looking one.
 */
export function normaliseRecoveryCode(input: string): string {
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += GROUP) {
    groups.push(compact.slice(i, i + GROUP));
  }
  return groups.join('-');
}

/** True only for a code that is safe to interpolate into a `PRAGMA key`. */
export function isValidRecoveryCode(input: string): boolean {
  return RECOVERY_CODE_PATTERN.test(normaliseRecoveryCode(input));
}
