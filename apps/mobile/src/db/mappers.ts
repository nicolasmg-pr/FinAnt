import { money, type CategoryRule, type Transaction } from '@finant/core';

export interface TransactionRow {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string | null;
  amount_minor: number;
  currency: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  category_id: string | null;
  category_source: string;
  source: string;
  external_id: string | null;
  import_hash: string;
  notes: string | null;
  excluded_from_stats: number;
  created_at: string;
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    bookingDate: row.booking_date,
    valueDate: row.value_date,
    amount: money(row.amount_minor, row.currency),
    description: row.description,
    counterparty: row.counterparty,
    reference: row.reference,
    categoryId: row.category_id,
    categorySource: row.category_source as Transaction['categorySource'],
    source: row.source as Transaction['source'],
    externalId: row.external_id,
    importHash: row.import_hash,
    notes: row.notes,
    excludedFromStats: row.excluded_from_stats === 1,
    createdAt: row.created_at,
  };
}

export interface RuleRow {
  id: string;
  category_id: string;
  priority: number;
  enabled: number;
  learned: number;
  match_json: string;
}

export function toRule(row: RuleRow): CategoryRule {
  return {
    id: row.id,
    categoryId: row.category_id,
    priority: row.priority,
    enabled: row.enabled === 1,
    learned: row.learned === 1,
    match: JSON.parse(row.match_json) as CategoryRule['match'],
  };
}
