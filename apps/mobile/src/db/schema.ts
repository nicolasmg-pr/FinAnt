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
  {
    version: 2,
    sql: `
      -- Sign alone cannot express a refund: a positive amount can belong on the
      -- expense side, where it reduces spending. Existing rows are backfilled
      -- from their sign, which is correct for everything imported so far.
      ALTER TABLE transactions ADD COLUMN side TEXT NOT NULL DEFAULT 'expense';
      UPDATE transactions SET side = CASE WHEN amount_minor > 0 THEN 'income' ELSE 'expense' END;

      CREATE INDEX idx_tx_side ON transactions(side);
    `,
  },
  {
    version: 3,
    sql: `
      -- The bank-aggregator integration is gone: movements now come only from
      -- statements the owner exports from their bank and imports by hand. These
      -- columns held aggregator consent state and have no other meaning.
      ALTER TABLE accounts DROP COLUMN requisition_id;
      ALTER TABLE accounts DROP COLUMN consent_expires_at;
      ALTER TABLE accounts DROP COLUMN external_account_id;
      ALTER TABLE accounts DROP COLUMN last_synced_at;
    `,
  },
  {
    version: 4,
    sql: `
      -- Deleting a movement must survive the next overlapping statement import.
      -- A hard delete would let INSERT OR IGNORE bring the row straight back,
      -- because the unique indexes only guard rows that still exist. So a
      -- deleted row keeps its place in the table and every read filters it out.
      ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
      CREATE INDEX idx_tx_deleted ON transactions(deleted_at);
    `,
  },
  {
    version: 5,
    sql: `
      -- Two halves of a move between the owner's own accounts point at each
      -- other. Both are categorised transfer-internal, which already keeps them
      -- out of every total; the link is what lets the detail screen show the
      -- counterpart and lets a manual re-categorisation undo the pairing.
      ALTER TABLE transactions ADD COLUMN transfer_peer_id TEXT;
      CREATE INDEX idx_tx_transfer_peer ON transactions(transfer_peer_id);
    `,
  },
  {
    version: 6,
    sql: `
      -- A bank groups accounts. The balance itself lives per account, because
      -- that is where the movements are; the bank view sums its accounts.
      CREATE TABLE institutions (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- accounts.institution_id already exists as a plain TEXT column from
      -- migration 1 and now holds institutions.id. It stays a plain column: a
      -- REFERENCES clause cannot be added to an existing SQLite column without
      -- rebuilding the whole table, which is not worth risking the ledger's
      -- foreign keys for a constraint the repository already enforces.

      -- What the owner asserts the account holds (balance_minor) on the day
      -- they asserted it for (balance_date), plus the opening balance derived
      -- from that claim. All nullable: an account whose balance was never
      -- asserted simply has none, and shows no figure rather than a wrong zero.
      ALTER TABLE accounts ADD COLUMN balance_minor INTEGER;
      ALTER TABLE accounts ADD COLUMN balance_date TEXT;
      ALTER TABLE accounts ADD COLUMN opening_balance_minor INTEGER;

      -- Accounts imported so far carry their bank's name as free text. Promote
      -- each distinct name to an institution and point the accounts at it;
      -- accounts with no name stay unassigned rather than inventing a bank.
      INSERT INTO institutions (id, name, created_at)
        SELECT 'inst-' || LOWER(HEX(RANDOMBLOB(8))), institution_name, MIN(created_at)
          FROM accounts
         WHERE institution_name IS NOT NULL AND TRIM(institution_name) != ''
         GROUP BY institution_name;

      UPDATE accounts
         SET institution_id = (SELECT id FROM institutions WHERE name = accounts.institution_name)
       WHERE institution_name IS NOT NULL AND TRIM(institution_name) != '';
    `,
  },
  {
    version: 7,
    sql: `
      -- Standing instructions to keep a kind of movement out of the statistics,
      -- learned when the owner excludes one movement and asks for the rest.
      --
      -- Its own table, not a row in "rules" with a null category: an exclusion
      -- rule has no category and never will. rules.category_id is NOT NULL with
      -- a foreign key onto categories, and that constraint is what stops a
      -- categorisation rule from pointing at a category that no longer exists.
      -- Making the column nullable to fit a second kind of rule in there would
      -- weaken the guarantee for every shipped rule, and every read of "rules"
      -- would then have to remember to filter out the rows that are not
      -- categorisations at all. Two questions, two tables. There is no priority
      -- column either: exclusion is not a contest between rules, any enabled
      -- rule that matches is enough.
      --
      -- Exclusion affects statistics only. It never changes an amount, a side
      -- or a balance: the movement stays in the ledger exactly as booked.
      CREATE TABLE exclusion_rules (
        id TEXT PRIMARY KEY NOT NULL,
        match_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        learned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 8,
    sql: `
      -- Categories stop being a constant the screens read and become rows the
      -- owner can add to, hide and reorder. Two columns make that work.
      --
      -- position is the order the list renders in. The shipped taxonomy is
      -- grouped by meaning, not alphabetically — "Rent" belongs next to
      -- "Mortgage", not between "Refunds" and "Restaurants" — and a category
      -- the owner adds has to be able to sit somewhere in that order.
      ALTER TABLE categories ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

      -- customised marks a shipped category the owner has renamed, recoloured
      -- or given another icon. syncBuiltInCategories() runs on every launch and
      -- would otherwise put the shipped label and colour straight back the next
      -- time the app opened, silently undoing the edit.
      ALTER TABLE categories ADD COLUMN customised INTEGER NOT NULL DEFAULT 0;

      -- Backfill in the order the taxonomy shipped at this version. Spelled out
      -- as literal ids rather than generated from BUILT_IN_CATEGORIES: a
      -- migration must produce the same result on a device replaying it three
      -- releases late, and a generated one would change under it. Ids the CASE
      -- does not name keep 0 and are placed by syncBuiltInCategories(), which
      -- runs straight after migrations and rewrites every shipped position.
      UPDATE categories SET position = CASE id
          WHEN 'income-salary' THEN 0
          WHEN 'income-freelance' THEN 1
          WHEN 'income-benefits' THEN 2
          WHEN 'income-investment' THEN 3
          WHEN 'income-refund' THEN 4
          WHEN 'income-other' THEN 5
          WHEN 'housing-rent' THEN 6
          WHEN 'housing-mortgage' THEN 7
          WHEN 'housing-utilities' THEN 8
          WHEN 'housing-internet' THEN 9
          WHEN 'housing-maintenance' THEN 10
          WHEN 'food-groceries' THEN 11
          WHEN 'food-restaurants' THEN 12
          WHEN 'transport-public' THEN 13
          WHEN 'transport-car' THEN 14
          WHEN 'transport-travel' THEN 15
          WHEN 'health-medical' THEN 16
          WHEN 'insurance' THEN 17
          WHEN 'insurance-health' THEN 18
          WHEN 'insurance-car' THEN 19
          WHEN 'subscriptions' THEN 20
          WHEN 'education' THEN 21
          WHEN 'childcare' THEN 22
          WHEN 'shopping' THEN 23
          WHEN 'leisure' THEN 24
          WHEN 'sport' THEN 25
          WHEN 'gifts-donations' THEN 26
          WHEN 'card-payment' THEN 27
          WHEN 'shared-costs' THEN 28
          WHEN 'taxes' THEN 29
          WHEN 'fees-interest' THEN 30
          WHEN 'savings' THEN 31
          WHEN 'cash' THEN 32
          WHEN 'transfer-internal' THEN 33
          WHEN 'uncategorised' THEN 34
          ELSE position
        END;
    `,
  },
  {
    version: 9,
    sql: `
      -- Movements gain a second origin: a push notification one of the owner's
      -- own bank apps posted on this device, read by an Android notification
      -- listener. Android only, opt-in, and never a substitute for a statement.
      --
      -- One row per bank app the owner allows. The label is theirs: nothing
      -- here is auto-created, and a package name is not a bank's name.
      CREATE TABLE notification_sources (
        id TEXT PRIMARY KEY NOT NULL,
        package_name TEXT NOT NULL,
        label TEXT NOT NULL,
        institution_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        -- Per source, not global: the owner will trust one bank's wording long
        -- before another's, and one switch would force the weakest template to
        -- gate the strongest.
        auto_approve INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_source_package ON notification_sources(package_name);

      -- A bank app is one channel for several accounts (a Girokonto and its
      -- Visa, card spend and savings-plan executions). match_json holds a
      -- RuleMatch tree, the same shape rules.match_json holds and evaluated by
      -- the same matcher. NULL marks the fallback route, used only when no
      -- discriminator matched, and there can be at most one per source.
      CREATE TABLE notification_routes (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT NOT NULL REFERENCES notification_sources(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        match_json TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_route_fallback ON notification_routes(source_id)
        WHERE match_json IS NULL;

      -- The inbox. This is the only place in FinAnt that holds a narrative the
      -- owner did not import deliberately, so it prunes itself: accepting or
      -- dismissing a capture NULLs title and body and keeps the row as a
      -- hash-only tombstone, which is what stops Android reposting the same
      -- notification from creating a second movement.
      --
      -- posted_at is a real timestamp, and the only one in this schema. Android
      -- reports postTime as epoch millis and there is no way around it, so it
      -- is converted to a local calendar day exactly once, at the edge, by
      -- localCalendarDay() in @finant/importers. Nothing downstream may derive
      -- a date from posted_at: that is how 1 March becomes February west of UTC.
      CREATE TABLE notification_captures (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT REFERENCES notification_sources(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        booking_date TEXT NOT NULL,
        title TEXT,
        body TEXT,
        android_key TEXT,
        capture_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        parser_id TEXT,
        parsed_json TEXT,
        transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_capture_hash ON notification_captures(capture_hash);
      CREATE INDEX idx_notif_capture_status ON notification_captures(status);

      -- A notification-born movement counts in the month's totals and in the
      -- account balance immediately, and is replaced by the statement row that
      -- books it. The owner accepting one by hand does not clear the flag:
      -- agreeing with the notification is not the bank having booked it.
      ALTER TABLE transactions ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;

      -- Set when reconciliation replaced a provisional with the statement row
      -- that booked it. The provisional is soft-deleted at the same moment, so
      -- this is the trail from what the owner saw to what the bank did.
      ALTER TABLE transactions ADD COLUMN superseded_by_id TEXT;

      CREATE INDEX idx_tx_provisional ON transactions(provisional) WHERE provisional = 1;
    `,
  },
  {
    version: 10,
    sql: `
      -- A fingerprint of a notification's text that survives settling, unlike
      -- title and body themselves: setCaptureStatus NULLs those on purpose, so
      -- a capture's narrative does not sit in the ledger past the moment the
      -- owner has dealt with it. content_hash is computed once, at capture
      -- time, from the same fields (never the post time, which a repost always
      -- changes), and kept forever after.
      --
      -- It is what lets a repost be recognised once the narrative it would
      -- have been compared against is already gone: matching an accepted row
      -- on its Android notification key alone, with no text and no fingerprint
      -- to check against, cannot tell a repost of that same payment from a
      -- genuinely different one arriving through the same reused notification
      -- slot — and would silently drop the second. content_hash plus the key
      -- together tell them apart.
      --
      -- Nullable, and left NULL rather than guessed at for any row that does
      -- not carry the title and body to compute it from: a capture already
      -- settled before this migration had its text NULLed under the old rule,
      -- and there is nothing left here to fingerprint. A NULL content_hash
      -- simply never matches, which is the safe direction.
      --
      -- This migration only adds the column. SQLite has no fnv1aHash, so the
      -- backfill for a pending or unreadable row that still holds its title
      -- and body runs straight after migrations, in JS, in
      -- backfillNotificationContentHashes() (database.ts) — the same place
      -- syncBuiltInCategories() and syncDefaultRules() already run their own
      -- post-migration fix-ups.
      ALTER TABLE notification_captures ADD COLUMN content_hash TEXT;
    `,
  },
  {
    version: 11,
    sql: `
      -- The portfolio. Two tables and a cache, and deliberately no holdings
      -- table: what the owner holds is summed from its legs on every read.
      -- A materialised holding is a second source of truth that drifts the
      -- first time a movement is edited, deleted or re-imported, and a few
      -- hundred legs cost nothing to add up.

      -- One security. The owner names it: a quote payload never renames a row
      -- behind their back, the same rule every other named entity follows.
      -- symbol is the ISIN for a security and the ticker for a crypto pair,
      -- and is unique because two rows for one ISIN would split a position in
      -- half without either half looking wrong.
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        asset_class TEXT NOT NULL CHECK (asset_class IN ('fund', 'stock', 'crypto')),
        currency TEXT NOT NULL,
        -- The price provider's own ticker once resolved, e.g. 'EUNL.DE'.
        -- NULL until a lookup succeeds; nothing is guessed from the ISIN.
        listing_symbol TEXT,
        -- Typed by the owner. Always beats a fetched quote, so the portfolio
        -- still values itself with no network at all.
        manual_price_scaled INTEGER,
        manual_price_scale INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_assets_symbol ON assets(symbol);

      -- One acquisition, disposal, or asset-tagged credit, hanging off the
      -- cash movement that paid for it. ON DELETE CASCADE because a leg
      -- without its movement is a holding nothing paid for.
      --
      -- shares_scaled is signed and zero on a dividend or benefit: a dividend
      -- row states the holding at payment time rather than shares acquired,
      -- and a saveback credits cash that a separate purchase then spends.
      -- cash_minor is the authoritative cost -- never price x shares.
      CREATE TABLE investment_legs (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id),
        kind TEXT NOT NULL CHECK (kind IN ('buy', 'sell', 'dividend', 'benefit')),
        booking_date TEXT NOT NULL,
        shares_scaled INTEGER NOT NULL,
        shares_scale INTEGER NOT NULL,
        unit_price_scaled INTEGER NOT NULL,
        unit_price_scale INTEGER NOT NULL,
        cash_minor INTEGER NOT NULL,
        fee_minor INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      -- Dedupe is the index's job, not the importer's: re-importing the same
      -- export must not double a position. One movement buys one asset once.
      CREATE UNIQUE INDEX idx_legs_tx_asset ON investment_legs(transaction_id, asset_id);
      CREATE INDEX idx_legs_asset_date ON investment_legs(asset_id, booking_date);

      -- The last price seen per asset. A cache, never a ledger: the screen
      -- renders from here offline, and as_of is shown so a stale figure is
      -- never mistaken for a live one.
      CREATE TABLE quotes (
        asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        price_scaled INTEGER NOT NULL,
        price_scale INTEGER NOT NULL,
        currency TEXT NOT NULL,
        as_of TEXT NOT NULL,
        source TEXT NOT NULL
      );
    `,
  },
  {
    version: 12,
    sql: `
      -- One closing price per asset per month, already converted into the
      -- portfolio's currency at that month's rate.
      --
      -- Monthly rather than daily on purpose: the chart plots month ends, so a
      -- daily series would be thirty times the rows and thirty times the
      -- requests to answer exactly the same question. A few hundred rows covers
      -- a decade of a personal portfolio.
      --
      -- Converted on the way in, not on the way out, because the rate that
      -- matters is the one that held that month. Valuing a 2024 holding of a
      -- dollar-quoted fund at today's dollar charts an exchange-rate move as if
      -- it were a market move.
      CREATE TABLE price_history (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        month TEXT NOT NULL,
        close_scaled INTEGER NOT NULL,
        close_scale INTEGER NOT NULL,
        currency TEXT NOT NULL,
        PRIMARY KEY (asset_id, month)
      );
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
