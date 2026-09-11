import {
  PRICE_SCALE,
  SHARE_SCALE,
  decimal,
  type Asset,
  type AssetClass,
  type Decimal,
  type InvestmentLeg,
  type LegKind,
  type PriceHistoryPoint,
  type Quote,
} from '@finant/core';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './database';

/** Local rather than imported from transactions-repo, which imports this file. */
function newId(): string {
  return Crypto.randomUUID();
}

/**
 * The portfolio's storage.
 *
 * Reads hand `buildPortfolio` its three inputs and nothing more: there is no
 * holdings table, because a holding is a sum of its legs and a stored sum is a
 * second source of truth that drifts the first time a movement is edited.
 */

interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  currency: string;
  listing_symbol: string | null;
  manual_price_scaled: number | null;
  manual_price_scale: number | null;
  archived: number;
}

interface LegRow {
  id: string;
  transaction_id: string;
  asset_id: string;
  kind: LegKind;
  booking_date: string;
  shares_scaled: number;
  shares_scale: number;
  unit_price_scaled: number;
  unit_price_scale: number;
  cash_minor: number;
  fee_minor: number;
  currency: string;
}

interface QuoteRow {
  asset_id: string;
  price_scaled: number;
  price_scale: number;
  currency: string;
  as_of: string;
  source: string;
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.asset_class,
    currency: row.currency,
    listingSymbol: row.listing_symbol,
    manualPrice:
      row.manual_price_scaled === null || row.manual_price_scale === null
        ? null
        : decimal(row.manual_price_scaled, row.manual_price_scale),
    archived: row.archived === 1,
  };
}

function toLeg(row: LegRow): InvestmentLeg {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    assetId: row.asset_id,
    kind: row.kind,
    bookingDate: row.booking_date,
    shares: decimal(row.shares_scaled, row.shares_scale),
    unitPrice: decimal(row.unit_price_scaled, row.unit_price_scale),
    cashAmount: { minor: row.cash_minor, currency: row.currency },
    fee: { minor: row.fee_minor, currency: row.currency },
  };
}

function toQuote(row: QuoteRow): Quote {
  return {
    assetId: row.asset_id,
    price: decimal(row.price_scaled, row.price_scale),
    currency: row.currency,
    asOf: row.as_of,
    source: row.source,
  };
}

export async function listAssets(): Promise<Asset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssetRow>('SELECT * FROM assets ORDER BY name;');
  return rows.map(toAsset);
}

export async function listLegs(): Promise<InvestmentLeg[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LegRow>(
    'SELECT * FROM investment_legs ORDER BY booking_date ASC, id ASC;',
  );
  return rows.map(toLeg);
}

export async function listQuotes(): Promise<Quote[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<QuoteRow>('SELECT * FROM quotes;');
  return rows.map(toQuote);
}

/** Everything `buildPortfolio` needs, in one round trip. */
export async function loadPortfolioInput(): Promise<{
  assets: Asset[];
  legs: InvestmentLeg[];
  quotes: Quote[];
  history: PriceHistoryPoint[];
}> {
  const [assets, legs, quotes, history] = await Promise.all([
    listAssets(),
    listLegs(),
    listQuotes(),
    listPriceHistory(),
  ]);
  return { assets, legs, quotes, history };
}

/**
 * Finds the asset a trade row names, creating it the first time.
 *
 * The symbol is unique: two rows for one ISIN would split a position in half
 * without either half looking wrong. An existing asset keeps the name it has —
 * the owner may have renamed it, and an import must not overwrite that.
 *
 * Runs on a caller-supplied handle so it can sit inside the same database
 * transaction as the movement that paid for it.
 */
export async function upsertAssetOn(
  db: SQLiteDatabase,
  asset: {
    symbol: string;
    name: string;
    assetClass: AssetClass;
    currency: string;
  },
): Promise<string> {
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM assets WHERE symbol = ?;',
    asset.symbol,
  );
  if (existing) return existing.id;

  const id = newId();
  await db.runAsync(
    `INSERT INTO assets (id, symbol, name, asset_class, currency, listing_symbol,
       manual_price_scaled, manual_price_scale, archived, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?);`,
    id,
    asset.symbol,
    asset.name,
    asset.assetClass,
    asset.currency,
    new Date().toISOString(),
  );
  return id;
}

export interface NewInvestmentLeg {
  assetId: string;
  kind: LegKind;
  bookingDate: string;
  shares: Decimal;
  unitPrice: Decimal;
  cashMinor: number;
  feeMinor: number;
  currency: string;
}

/**
 * Attaches a leg to the movement that paid for it.
 *
 * `INSERT OR IGNORE` leans on the unique index rather than on the caller
 * remembering: re-importing the same export must not double a position.
 */
export async function insertLegOn(
  db: SQLiteDatabase,
  transactionId: string,
  leg: NewInvestmentLeg,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO investment_legs (
       id, transaction_id, asset_id, kind, booking_date, shares_scaled, shares_scale,
       unit_price_scaled, unit_price_scale, cash_minor, fee_minor, currency, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    newId(),
    transactionId,
    leg.assetId,
    leg.kind,
    leg.bookingDate,
    leg.shares.scaled,
    leg.shares.scale,
    leg.unitPrice.scaled,
    leg.unitPrice.scale,
    leg.cashMinor,
    leg.feeMinor,
    leg.currency,
    new Date().toISOString(),
  );
}

/** The owner's own name for a security. An import never overwrites it. */
export async function renameAsset(assetId: string, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE assets SET name = ? WHERE id = ?;', name.trim(), assetId);
}

/** A price the owner typed. Always beats a fetched quote. Null clears it. */
export async function setManualPrice(assetId: string, price: Decimal | null): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE assets SET manual_price_scaled = ?, manual_price_scale = ? WHERE id = ?;',
    price?.scaled ?? null,
    price?.scale ?? null,
    assetId,
  );
}

/** Remembers the provider's ticker so the next refresh skips the lookup. */
export async function setListingSymbol(assetId: string, listingSymbol: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE assets SET listing_symbol = ? WHERE id = ?;', listingSymbol, assetId);
}

/** Replaces the cached price for each asset quoted. Nothing else is touched. */
export async function saveQuotes(quotes: readonly Quote[]): Promise<void> {
  if (quotes.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const q of quotes) {
      await db.runAsync(
        `INSERT INTO quotes (asset_id, price_scaled, price_scale, currency, as_of, source)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(asset_id) DO UPDATE SET
           price_scaled = excluded.price_scaled,
           price_scale = excluded.price_scale,
           currency = excluded.currency,
           as_of = excluded.as_of,
           source = excluded.source;`,
        q.assetId,
        q.price.scaled,
        q.price.scale,
        q.currency,
        q.asOf,
        q.source,
      );
    }
  });
}

/** The scales the schema stores, so a caller need not repeat them. */
export const STORED_SHARE_SCALE = SHARE_SCALE;
export const STORED_PRICE_SCALE = PRICE_SCALE;

interface HistoryRow {
  asset_id: string;
  month: string;
  close_scaled: number;
  close_scale: number;
  currency: string;
}

export async function listPriceHistory(): Promise<PriceHistoryPoint[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<HistoryRow>(
    'SELECT * FROM price_history ORDER BY asset_id, month;',
  );
  return rows.map((row) => ({
    assetId: row.asset_id,
    month: row.month,
    close: decimal(row.close_scaled, row.close_scale),
  }));
}

/** The newest month already stored per asset, so a backfill asks only for the gap. */
export async function latestHistoryMonths(): Promise<Map<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ asset_id: string; month: string }>(
    'SELECT asset_id, MAX(month) AS month FROM price_history GROUP BY asset_id;',
  );
  return new Map(rows.map((row) => [row.asset_id, row.month]));
}

export async function savePriceHistory(
  points: readonly (PriceHistoryPoint & { currency: string })[],
): Promise<void> {
  if (points.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const point of points) {
      await db.runAsync(
        `INSERT INTO price_history (asset_id, month, close_scaled, close_scale, currency)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(asset_id, month) DO UPDATE SET
           close_scaled = excluded.close_scaled,
           close_scale = excluded.close_scale,
           currency = excluded.currency;`,
        point.assetId,
        point.month,
        point.close.scaled,
        point.close.scale,
        point.currency,
      );
    }
  });
}
