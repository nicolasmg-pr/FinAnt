import { isShippedRuleId, parseRetiredShippedRules } from './default-rules';
import type { CategoryRule } from './types';

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
 * The order is the merge order, and it is belt-and-braces rather than the
 * mechanism: the restore runs with `PRAGMA defer_foreign_keys = ON`, so every
 * foreign key is checked at commit and not at the statement, which is exactly
 * what lets one transaction hold a child that arrives before its parent. What
 * the order buys is a readable failure and no reliance on that deferral being
 * in force — see `docs/backup-format.md`, "One transaction, and why the
 * connection needs two pragmas, not one". `backup-coverage.test.ts` asserts that this list plus
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
 * `PRAGMA key` in passphrase form, for opening a backup file on its own
 * connection. Must be the first statement on that connection: SQLCipher reads
 * the header with it, and any query issued before it fails with "file is not a
 * database" on an encrypted file.
 */
export function openBackupSql(code: string): string {
  if (!isValidRecoveryCode(code)) {
    throw new Error('refusing to open with a malformed recovery code');
  }
  return `PRAGMA key = '${normaliseRecoveryCode(code)}';`;
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

/**
 * A live `rules` row, as the merge reads it back before writing anything.
 *
 * Only the columns that decide whether the owner has touched a rule are here.
 * `created_at` is deliberately absent: a seeded rule carries the moment the app
 * first launched on *this* phone, which is never equal to the backup's and says
 * nothing about whether the owner changed anything.
 */
export interface StoredRuleRow {
  readonly id: string;
  readonly categoryId: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly learned: boolean;
  readonly matchJson: string;
}

/**
 * Which live rules are still exactly the rule this release seeds, untouched.
 *
 * The device-wins rule protects the owner's work. A row the app wrote to itself
 * at first launch — `syncDefaultRules()` in `db/database.ts`, which runs on
 * every open and therefore before any restore can — is not the owner's work,
 * and letting it beat the backup silently reverts every rule edit the owner
 * ever made the moment they restore onto a fresh install.
 *
 * `rules` carries no `customised` flag, so "untouched" is established by
 * comparison instead: a seeded row's category, priority, enabled and learned
 * flags and serialised match are all written straight from `DEFAULT_RULES`, so
 * a row that still equals its shipped definition in every one of them is one
 * nothing has edited. `match_json` is compared as the exact string
 * `JSON.stringify` produced, which errs the safe way: a serialisation that
 * differs only in key order reads as edited, and an edited rule is one the
 * device keeps.
 */
export function pristineShippedRuleIds(
  shipped: readonly CategoryRule[],
  live: readonly StoredRuleRow[],
): string[] {
  const byId = new Map(live.map((row) => [row.id, row]));
  const pristine: string[] = [];
  for (const rule of shipped) {
    const row = byId.get(rule.id);
    if (row === undefined) continue;
    if (
      row.categoryId === rule.categoryId &&
      row.priority === rule.priority &&
      row.enabled === rule.enabled &&
      row.learned === rule.learned &&
      row.matchJson === JSON.stringify(rule.match)
    ) {
      pristine.push(rule.id);
    }
  }
  return pristine;
}

/** A column name is interpolated, so it has to look like one. */
const COLUMN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Writes the backup's row over a live row that is still in its seeded state.
 *
 * The shape is an `UPDATE` from the attached file rather than a `DELETE` and a
 * re-`INSERT`: deleting a category would take the owner's live rows with it —
 * `transactions.category_id` is `ON DELETE SET NULL`, `rules` and `budgets`
 * cascade — and no restore may ever cost a categorisation.
 *
 * `columns` comes from `PRAGMA table_info` on the live side, which
 * `assertColumnsMatch` has already proved identical to the backup's, so the
 * statement never names a column one side lacks and never has to be updated by
 * hand when a migration adds one. Every name is still checked against
 * `COLUMN_PATTERN` before interpolation, the same way the table name is
 * checked against the manifest.
 */
function reseedSql(table: string, columns: readonly string[], predicate: string): string {
  if (!BACKUP_TABLES.includes(table)) {
    throw new Error('refusing to reseed a table outside the backup manifest');
  }
  if (!columns.includes('id')) {
    throw new Error('refusing to reseed a table without an id column');
  }
  for (const column of columns) {
    if (!COLUMN_PATTERN.test(column)) {
      throw new Error('refusing to reseed with an unrecognised column name');
    }
  }
  const writable = columns.filter((column) => column !== 'id');
  if (writable.length === 0) {
    throw new Error('refusing to reseed a table with nothing but an id');
  }

  const selected = writable.map((column) => `b.${column}`).join(', ');
  // A one-column row value is not worth relying on across SQLite versions, so
  // the single-column form is spelled out instead.
  const assignment =
    writable.length === 1
      ? `${writable[0] ?? ''} = (SELECT ${selected} FROM ${ATTACHED}.${table} AS b WHERE b.id = c.id)`
      : `(${writable.join(', ')}) = (SELECT ${selected} FROM ${ATTACHED}.${table} AS b WHERE b.id = c.id)`;

  return (
    `UPDATE main.${table} AS c SET ${assignment} ` +
    `WHERE ${predicate} ` +
    `AND EXISTS (SELECT 1 FROM ${ATTACHED}.${table} AS b WHERE b.id = c.id);`
  );
}

/**
 * The backup wins over a built-in category the owner has never touched.
 *
 * A fresh install seeds every shipped category before a restore can run, so
 * `INSERT OR IGNORE` alone would reinstate the shipped name, colour and icon
 * over the owner's renamed, recoloured, rearranged taxonomy — permanently,
 * since `syncBuiltInCategories()` only ever writes shipped values back.
 *
 * Three conditions decide that a live row is the app's own seed rather than
 * the owner's work, and each one is a way the owner leaves a mark:
 *
 * - `built_in = 1` — a category the owner created is theirs, id collision or
 *   not, and is never overwritten;
 * - `customised = 0` — the flag `editCategory()` sets and
 *   `syncBuiltInCategories()` already reads for exactly this question;
 * - `archived = 0` — archiving is the one edit that does *not* set
 *   `customised` (`archiveCategory()` writes only `archived`), so a hidden
 *   category would otherwise look pristine and be unhidden by a backup taken
 *   before the owner hid it. Requiring it also settles `archived` in the other
 *   direction on purpose: a row that is pristine here takes the backup's
 *   `archived` with everything else, which is what brings back a category the
 *   owner archived on the phone they lost.
 */
export function reseedPristineCategoriesSql(columns: readonly string[]): string {
  return reseedSql('categories', columns, 'c.built_in = 1 AND c.customised = 0 AND c.archived = 0');
}

/** `'a', 'b'` — for an `IN` list of ids the caller has already vouched for. */
function idList(ids: readonly string[]): string {
  return ids.map((id) => `'${quote(id)}'`).join(', ');
}

/**
 * The backup wins over the shipped rules a fresh install seeded to itself.
 *
 * `ids` must come from `pristineShippedRuleIds()`: they are the rules this
 * build ships whose live row still matches the shipped definition exactly. A
 * rule the owner disabled, re-pointed or wrote themselves is not in that list
 * and keeps the phone's version, which is device-wins as intended.
 */
export function reseedPristineRulesSql(columns: readonly string[], ids: readonly string[]): string {
  if (ids.length === 0) {
    throw new Error('refusing to reseed rules without naming any');
  }
  for (const id of ids) {
    if (!isShippedRuleId(id)) {
      throw new Error('refusing to reseed a rule this release does not ship');
    }
  }
  return reseedSql('rules', columns, `c.id IN (${idList(ids)})`);
}

/**
 * Removes shipped rules a fresh install seeded that the backup says the owner
 * had deleted.
 *
 * The tombstone list lives in `settings` (`retiredShippedRules`), so it only
 * arrives with the restore — by which time `syncDefaultRules()` has long since
 * reinstalled every rule it names. Without this, a shipped rule the owner
 * deliberately deleted comes back and stays back, filing movements under a
 * category they rejected.
 *
 * Only rules still in their seeded state are removed, for the same reason the
 * reseed above only overwrites those: if the row has been edited it is the
 * owner's, whatever an older tombstone says about it.
 */
export function deleteRetiredShippedRulesSql(ids: readonly string[]): string {
  if (ids.length === 0) {
    throw new Error('refusing to delete rules without naming any');
  }
  for (const id of ids) {
    if (!isShippedRuleId(id)) {
      throw new Error('refusing to delete a rule this release does not ship');
    }
  }
  return `DELETE FROM main.rules WHERE id IN (${idList(ids)});`;
}

/**
 * Unions two tombstone lists rather than letting either replace the other.
 *
 * Every other row in `settings` is a preference, and `INSERT OR IGNORE` — the
 * device's own row wins outright — is the right rule for a preference.
 * `retiredShippedRules` is not one: each id in it is a fact, "a shipped rule
 * was deleted, somewhere," and two devices' facts do not conflict, they
 * accumulate. Letting `INSERT OR IGNORE` pick a side here would mean a phone
 * that already has its own tombstone list silently keeps only its own ids,
 * dropping every id the backup alone remembers — and the merge deletes those
 * rules from `rules` in the same restore, so the very next launch's
 * `syncDefaultRules()` reinstalls them, quietly undoing the restore's own
 * deletion. See "Table manifest" in `docs/backup-format.md`.
 *
 * Either input may be `null` or malformed — the same tolerance
 * `parseRetiredShippedRules` gives a corrupt setting, so a bad value on
 * either side costs at most re-installing an already-deleted rule once, never
 * a failed restore. Deduplicated, and deterministic: the device's own ids keep
 * their stored order first, then any id the backup names that the device does
 * not already have is appended in the backup's order — so the same two inputs
 * always produce the same list, which is what makes writing it back a no-op
 * the second time.
 */
export function mergeRetiredShippedRuleIds(
  deviceValue: string | null,
  backupValue: string | null,
): string[] {
  const device = parseRetiredShippedRules(deviceValue);
  const backup = parseRetiredShippedRules(backupValue);
  const seen = new Set(device);
  const merged = [...device];
  for (const id of backup) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

/**
 * Serialises a tombstone list exactly the way `parseRetiredShippedRules`
 * reads it back — a plain JSON array of strings, the same shape `deleteRule()`
 * writes in `apps/mobile/src/db/rules-repo.ts`. Kept beside
 * `mergeRetiredShippedRuleIds()` so the write side of the round trip is never
 * updated without the read side in the same change.
 */
export function serialiseRetiredShippedRules(ids: readonly string[]): string {
  return JSON.stringify(ids);
}
