import { categorise, shouldExclude } from '@finant/core';
import type { DraftTransaction } from '@finant/importers';
import { listExclusionRules } from '../db/exclusion-rules-repo';
import { listRules } from '../db/rules-repo';
import { insertTransactions, type NewTransaction } from '../db/transactions-repo';
import { reconcileProvisionals } from './reconcile';
import { detectTransfers } from './transfers';

export interface IngestResult {
  readonly inserted: number;
  readonly duplicates: number;
  readonly autoCategorised: number;
  readonly uncategorised: number;
  /** Transfers between the owner's accounts paired by this import. */
  readonly transfersMatched: number;
  /** Rows an exclusion rule kept out of the statistics on arrival. */
  readonly autoExcluded: number;
  /** Provisional movements a statement row in this import replaced. */
  readonly superseded: number;
}

/**
 * How many times reconciliation has thrown since the process started.
 *
 * An import must not fail over it — the statement's rows are already durably
 * inserted by then — but a swallowed failure that leaves no trace at all is
 * indistinguishable from a run with nothing to reconcile. Nothing about the
 * error is kept: a message would carry the owner's own data.
 */
let reconciliationFailures = 0;

/** For a future diagnostics surface, and for a reader wondering whether
 * reconciliation ever ran. Never rendered today, and never logged. */
export function reconciliationFailureCount(): number {
  return reconciliationFailures;
}

export interface IngestOptions {
  /**
   * Marks every row in this batch as provisional: its only evidence is a push
   * notification. Statement imports and manual entries never set it.
   */
  readonly provisional?: boolean;
}

/**
 * The single path every movement takes into the database, whatever its origin:
 * file import, manual entry, or a captured push notification staged as
 * provisional via `options.provisional`.
 *
 * A category that came with the file (the owner's own spreadsheet column) is
 * trusted over the rule engine — it is their classification, already correct,
 * and re-deriving it would silently rewrite years of history.
 *
 * Exclusion runs after categorisation and independently of it: "does this
 * count" is a different question from "what is this". A movement the owner
 * already excluded by name must not spend a month inside the totals just
 * because it arrived again in a newer statement.
 */
export async function ingest(
  drafts: readonly DraftTransaction[],
  options: IngestOptions = {},
): Promise<IngestResult> {
  const rules = await listRules();
  const exclusions = await listExclusionRules();
  let autoCategorised = 0;
  let uncategorised = 0;

  const batch: NewTransaction[] = drafts.map((draft) => {
    let categoryId: string | null;
    let categorySource: NewTransaction['categorySource'];

    if (draft.suggestedCategoryId) {
      categoryId = draft.suggestedCategoryId;
      categorySource = 'manual';
      autoCategorised += 1;
    } else {
      const result = categorise(draft, rules);
      categoryId = result.categoryId;
      categorySource = result.ruleId ? 'auto' : 'none';
      if (result.ruleId) autoCategorised += 1;
      else uncategorised += 1;
    }

    const excludedFromStats = shouldExclude(draft, exclusions);

    return {
      accountId: draft.accountId,
      bookingDate: draft.bookingDate,
      valueDate: draft.valueDate,
      amountMinor: draft.amount.minor,
      currency: draft.amount.currency,
      side: draft.side,
      description: draft.description,
      counterparty: draft.counterparty,
      reference: draft.reference,
      categoryId,
      categorySource,
      source: draft.source,
      externalId: draft.externalId,
      importHash: draft.importHash,
      notes: draft.notes,
      excludedFromStats,
      provisional: options.provisional ?? false,
    };
  });

  // Counted from what was actually written, not from what was offered: a
  // re-imported statement must not report the same exclusions a second time.
  const { inserted, duplicates, excluded: autoExcluded } = await insertTransactions(batch);

  // Reconciliation runs before transfer detection: a provisional and the
  // statement row that books it must not be paired with each other, and the
  // provisional has to be retired before the matcher sees the ledger.
  //
  // A statement's rows are already durably inserted by this point, and
  // reconciliation is now atomic per pair — so a failure here leaves the
  // provisionals live and the next import retries them. Failing the whole
  // import over it would tell the owner nothing was saved when almost
  // everything was, and this codebase does not throw away an import over
  // one bad row.
  let superseded = 0;
  if (inserted > 0 && !options.provisional) {
    try {
      superseded = (await reconcileProvisionals()).superseded;
    } catch {
      // Counted rather than logged: the only thing there is to log here is a
      // message about the owner's own movements, and this codebase logs none.
      // A reconciliation that silently never fires otherwise looks exactly
      // like one with nothing to do, so `reconciliationFailureCount()` leaves a
      // reader something to find.
      reconciliationFailures += 1;
      superseded = 0;
    }
  }

  // Only a new row can complete a pair; a file full of duplicates changes nothing.
  const transfersMatched = inserted > 0 ? await detectTransfers() : 0;
  return {
    inserted,
    duplicates,
    autoCategorised,
    uncategorised,
    transfersMatched,
    autoExcluded,
    superseded,
  };
}
