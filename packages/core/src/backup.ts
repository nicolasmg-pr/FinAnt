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

/** Written into every exported file so a future reader can tell what it is. */
export const BACKUP_FORMAT = 'finant-backup-1';

/** The one table that exists inside a backup file and not in the live schema. */
export const BACKUP_META_TABLE = 'backup_meta';

/** The schema name an exported database is attached under, on both sides. */
const ATTACHED = 'backup';

/**
 * Every table a backup carries, foreign-key parents first.
 *
 * The order is the merge order and it is load-bearing: the restore runs with
 * foreign keys on, so a child row inserted before its parent fails the whole
 * transaction. `backup-coverage.test.ts` asserts that this list plus
 * `EXCLUDED_TABLES` accounts for every table the migrations create, so a table
 * added later cannot be silently left out of the backup.
 */
export const BACKUP_TABLES: readonly string[] = [
  'institutions',
  'accounts',
  'categories',
  'import_profiles',
  'rules',
  'budgets',
  'exclusion_rules',
  'transactions',
  'assets',
  'investment_legs',
  'quotes',
  'price_history',
  'notification_sources',
  'notification_routes',
  'settings',
];

/**
 * Left out of the backup on purpose.
 *
 * `notification_captures` holds the raw title and body of a bank's own
 * notifications — real movement text, and the most sensitive free text in the
 * database. It is also a transient inbox: anything the owner accepted from it
 * is already a `transactions` row, so excluding it costs an unreviewed queue
 * and keeps that text out of a file that leaves the device.
 */
export const EXCLUDED_TABLES: readonly string[] = ['notification_captures'];

/** Doubles the single quotes SQLite uses to escape them inside a string literal. */
function quote(literal: string): string {
  return literal.replace(/'/g, "''");
}

/**
 * Attaches the backup file with the recovery code as a **passphrase**.
 *
 * Passphrase form, not the `x'...'` raw-key form the live database uses, so
 * SQLCipher runs its own KDF — PBKDF2-HMAC-SHA512, 256k iterations, random
 * per-file salt. The live key is already 256 random bits and needs none of
 * that; a file that may sit in cloud storage does.
 *
 * The code is validated, not escaped. `PRAGMA`/`ATTACH ... KEY` cannot be
 * parameterised, so a code that does not match the pattern is refused here
 * rather than quoted and hoped for.
 */
export function attachBackupSql(path: string, code: string): string {
  if (!isValidRecoveryCode(code)) {
    throw new Error('refusing to attach with a malformed recovery code');
  }
  return `ATTACH DATABASE '${quote(path)}' AS ${ATTACHED} KEY '${normaliseRecoveryCode(code)}';`;
}

/** Clones schema and rows into the attached file. Does **not** copy `user_version`. */
export function exportBackupSql(): string {
  return `SELECT sqlcipher_export('${ATTACHED}');`;
}

/** The metadata table, created inside the exported file after the export. */
export function createMetaTableSql(): string {
  return (
    `CREATE TABLE ${ATTACHED}.${BACKUP_META_TABLE} (` +
    'format TEXT NOT NULL, app_version TEXT NOT NULL, ' +
    'schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);'
  );
}

/**
 * The merge, for one table.
 *
 * `INSERT OR IGNORE` **is** the device-wins rule: it skips a row whose primary
 * key is taken, and it skips a movement the unique indexes already cover —
 * `idx_tx_external (account_id, external_id)` and
 * `idx_tx_hash (account_id, import_hash)`, the same indexes that guard an
 * overlapping import. Restoring therefore cannot overwrite a recategorisation
 * made on the phone, and running it twice adds nothing the first run did not.
 *
 * `SELECT *` is safe only because the caller has migrated the backup to the
 * current schema and asserted both sides' columns agree. The table name is
 * whitelisted because it is interpolated.
 */
export function mergeTableSql(table: string): string {
  if (!BACKUP_TABLES.includes(table)) {
    throw new Error('refusing to merge a table outside the backup manifest');
  }
  return `INSERT OR IGNORE INTO main.${table} SELECT * FROM ${ATTACHED}.${table};`;
}

export function detachBackupSql(): string {
  return `DETACH DATABASE ${ATTACHED};`;
}
