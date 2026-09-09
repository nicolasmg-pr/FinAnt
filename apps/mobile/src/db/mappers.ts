import {
  money,
  type Budget,
  type Category,
  type CategoryKind,
  type CategoryRule,
  type ExclusionRule,
  type NotificationRoute,
  type RuleMatch,
  type Transaction,
  type TransactionSide,
} from '@finant/core';
import type { ParsedMovement } from '@finant/importers';

export interface TransactionRow {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string | null;
  amount_minor: number;
  currency: string;
  side: string;
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
  /** Other half of a matched internal transfer; null otherwise. */
  transfer_peer_id: string | null;
  /** 1 while a push notification is the only evidence for this movement. */
  provisional: number;
  /** The statement row that booked this provisional, once one did. */
  superseded_by_id: string | null;
  /** Set by a soft delete. Rows with a value never leave the repository. */
  deleted_at: string | null;
  created_at: string;
}

export function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    bookingDate: row.booking_date,
    valueDate: row.value_date,
    amount: money(row.amount_minor, row.currency),
    side: row.side as TransactionSide,
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
    transferPeerId: row.transfer_peer_id,
    provisional: row.provisional === 1,
    supersededById: row.superseded_by_id,
    createdAt: row.created_at,
  };
}

export interface CategoryRow {
  id: string;
  /** Null for a category the owner created: it has a name, not a translation. */
  label_key: string | null;
  name: string;
  kind: string;
  parent_id: string | null;
  color: string;
  icon: string;
  built_in: number;
  archived: number;
  /** Render order. See migration 8. */
  position: number;
  /** Set once the owner edits a shipped category, so the launch sync leaves it alone. */
  customised: number;
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    // Written conditionally rather than as `labelKey: undefined`: the domain
    // type declares the property optional, not optionally undefined.
    ...(row.label_key === null ? {} : { labelKey: row.label_key }),
    name: row.name,
    kind: row.kind as CategoryKind,
    parentId: row.parent_id,
    color: row.color,
    icon: row.icon,
    builtIn: row.built_in === 1,
    archived: row.archived === 1,
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

/**
 * An exclusion rule carries no category, which is why it lives in its own
 * table rather than as a `rules` row with a nullable `category_id`.
 */
export interface ExclusionRuleRow {
  id: string;
  match_json: string;
  enabled: number;
  learned: number;
}

export function toExclusionRule(row: ExclusionRuleRow): ExclusionRule {
  return {
    id: row.id,
    enabled: row.enabled === 1,
    learned: row.learned === 1,
    match: JSON.parse(row.match_json) as ExclusionRule['match'],
  };
}

export interface BudgetRow {
  category_id: string;
  limit_minor: number;
  currency: string;
}

export function toBudget(row: BudgetRow): Budget {
  return {
    categoryId: row.category_id,
    monthlyLimit: money(row.limit_minor, row.currency),
  };
}

export type CaptureStatus = 'pending' | 'unreadable' | 'accepted' | 'dismissed';

export interface NotificationSource {
  readonly id: string;
  readonly packageName: string;
  readonly label: string;
  readonly institutionId: string | null;
  readonly enabled: boolean;
  readonly autoApprove: boolean;
}

export interface NotificationSourceRow {
  id: string;
  package_name: string;
  label: string;
  institution_id: string | null;
  enabled: number;
  auto_approve: number;
}

export function toNotificationSource(row: NotificationSourceRow): NotificationSource {
  return {
    id: row.id,
    packageName: row.package_name,
    label: row.label,
    institutionId: row.institution_id,
    enabled: row.enabled === 1,
    autoApprove: row.auto_approve === 1,
  };
}

export interface NotificationRouteRow {
  id: string;
  source_id: string;
  account_id: string;
  match_json: string | null;
  priority: number;
}

export function toNotificationRoute(row: NotificationRouteRow): NotificationRoute {
  return {
    id: row.id,
    sourceId: row.source_id,
    accountId: row.account_id,
    match: row.match_json === null ? null : (JSON.parse(row.match_json) as RuleMatch),
    priority: row.priority,
  };
}

/**
 * A captured notification. `title` and `body` are null once the capture has
 * been accepted or dismissed: the row survives as a tombstone so the same
 * notification cannot be captured twice, without keeping the narrative.
 */
export interface NotificationCapture {
  readonly id: string;
  readonly sourceId: string | null;
  readonly packageName: string;
  readonly postedAt: string;
  readonly bookingDate: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly captureHash: string;
  readonly status: CaptureStatus;
  readonly parserId: string | null;
  readonly parsed: ParsedMovement | null;
  readonly transactionId: string | null;
}

export interface NotificationCaptureRow {
  id: string;
  source_id: string | null;
  package_name: string;
  posted_at: string;
  booking_date: string;
  title: string | null;
  body: string | null;
  android_key: string | null;
  capture_hash: string;
  status: string;
  parser_id: string | null;
  parsed_json: string | null;
  transaction_id: string | null;
}

export function toNotificationCapture(row: NotificationCaptureRow): NotificationCapture {
  return {
    id: row.id,
    sourceId: row.source_id,
    packageName: row.package_name,
    postedAt: row.posted_at,
    bookingDate: row.booking_date,
    title: row.title,
    body: row.body,
    captureHash: row.capture_hash,
    status: row.status as CaptureStatus,
    parserId: row.parser_id,
    parsed: row.parsed_json === null ? null : (JSON.parse(row.parsed_json) as ParsedMovement),
    transactionId: row.transaction_id,
  };
}
