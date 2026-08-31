import { categorise } from '@finant/core';
import type { DraftTransaction } from '@finant/importers';
import { listRules } from '../db/rules-repo';
import { insertTransactions, type NewTransaction } from '../db/transactions-repo';

export interface IngestResult {
  readonly inserted: number;
  readonly duplicates: number;
  readonly autoCategorised: number;
  readonly uncategorised: number;
}

/**
 * The single path every movement takes into the database, whatever its origin:
 * bank sync, file import or manual entry.
 *
 * A category that came with the file (the owner's own spreadsheet column) is
 * trusted over the rule engine — it is their classification, already correct,
 * and re-deriving it would silently rewrite years of history.
 */
export async function ingest(drafts: readonly DraftTransaction[]): Promise<IngestResult> {
  const rules = await listRules();
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

    return {
      accountId: draft.accountId,
      bookingDate: draft.bookingDate,
      valueDate: draft.valueDate,
      amountMinor: draft.amount.minor,
      currency: draft.amount.currency,
      description: draft.description,
      counterparty: draft.counterparty,
      reference: draft.reference,
      categoryId,
      categorySource,
      source: draft.source,
      externalId: draft.externalId,
      importHash: draft.importHash,
      notes: draft.notes,
    };
  });

  const { inserted, duplicates } = await insertTransactions(batch);
  return { inserted, duplicates, autoCategorised, uncategorised };
}
