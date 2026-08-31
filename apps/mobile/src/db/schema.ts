/**
 * Schema migrations, applied in order on every launch.
 *
 * Append-only: never edit a shipped migration, add the next one. A device that
 * skipped three releases replays them all, and an edited migration would leave
 * those two devices with different tables.
 */
export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        iban TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',
        institution_id TEXT,
        institution_name TEXT,
        provider TEXT NOT NULL,
        external_account_id TEXT,
        requisition_id TEXT,
        consent_expires_at TEXT,
        last_synced_at TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        label_key TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE transactions (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        booking_date TEXT NOT NULL,
        value_date TEXT,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        description TEXT NOT NULL,
        counterparty TEXT,
        reference TEXT,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        category_source TEXT NOT NULL DEFAULT 'none',
        source TEXT NOT NULL,
        external_id TEXT,
        import_hash TEXT NOT NULL,
        notes TEXT,
        excluded_from_stats INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      -- Dedupe is enforced by the database, not by application discipline: a
      -- re-imported CSV or an overlapping bank sync must never double a figure.
      CREATE UNIQUE INDEX idx_tx_external ON transactions(account_id, external_id)
        WHERE external_id IS NOT NULL;
      CREATE UNIQUE INDEX idx_tx_hash ON transactions(account_id, import_hash);

      -- Every dashboard query filters by month, so the range scan needs this.
      CREATE INDEX idx_tx_booking_date ON transactions(booking_date);
      CREATE INDEX idx_tx_category ON transactions(category_id);

      CREATE TABLE rules (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        learned INTEGER NOT NULL DEFAULT 0,
        match_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE budgets (
        category_id TEXT PRIMARY KEY NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        limit_minor INTEGER NOT NULL,
        currency TEXT NOT NULL
      );

      CREATE TABLE import_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        label TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
