import type { Category } from './types';

function cat(
  id: string,
  name: string,
  kind: Category['kind'],
  color: string,
  icon: string,
  parentId: string | null = null,
): Category {
  return {
    id,
    labelKey: `category.${id}`,
    name,
    kind,
    parentId,
    color,
    icon,
    builtIn: true,
    archived: false,
  };
}

/**
 * Shipped taxonomy. `name` is the English fallback; the UI renders `labelKey`
 * through @finant/i18n so the same category id reads correctly in en/es/de.
 * Ids are stable and must never be renamed — rules and history point at them.
 */
export const BUILT_IN_CATEGORIES: readonly Category[] = [
  // Income
  cat('income-salary', 'Salary', 'income', '#2E7D32', 'briefcase'),
  cat('income-freelance', 'Freelance', 'income', '#388E3C', 'laptop'),
  cat('income-benefits', 'Benefits & pensions', 'income', '#43A047', 'shield'),
  cat('income-investment', 'Investment income', 'income', '#66BB6A', 'trending-up'),
  cat('income-refund', 'Refunds', 'income', '#81C784', 'rotate-ccw'),
  cat('income-other', 'Other income', 'income', '#A5D6A7', 'plus-circle'),

  // Housing
  cat('housing-rent', 'Rent', 'expense', '#5E35B1', 'home'),
  cat('housing-mortgage', 'Mortgage', 'expense', '#673AB7', 'key'),
  cat('housing-utilities', 'Utilities', 'expense', '#7E57C2', 'zap'),
  cat('housing-internet', 'Internet & phone', 'expense', '#9575CD', 'wifi'),
  cat('housing-maintenance', 'Home maintenance', 'expense', '#B39DDB', 'tool'),

  // Daily life
  cat('food-groceries', 'Groceries', 'expense', '#00897B', 'shopping-cart'),
  cat('food-restaurants', 'Restaurants & bars', 'expense', '#00ACC1', 'coffee'),
  cat('transport-public', 'Public transport', 'expense', '#039BE5', 'train'),
  cat('transport-car', 'Car & fuel', 'expense', '#1E88E5', 'car'),
  cat('transport-travel', 'Travel & holidays', 'expense', '#3949AB', 'plane'),

  // Recurring commitments
  cat('health-medical', 'Health', 'expense', '#D81B60', 'heart'),
  // Insurance splits three ways. `insurance` keeps its id — rules and years of
  // history point at it — and only its label moved to "Other insurance".
  cat('insurance', 'Other insurance', 'expense', '#8E24AA', 'umbrella'),
  cat('insurance-health', 'Health insurance', 'expense', '#AB47BC', 'thermometer'),
  cat('insurance-car', 'Car insurance', 'expense', '#BA68C8', 'truck'),
  cat('subscriptions', 'Subscriptions', 'expense', '#F4511E', 'repeat'),
  cat('education', 'Education', 'expense', '#6D4C41', 'book'),
  cat('childcare', 'Childcare', 'expense', '#EC407A', 'smile'),

  // Discretionary
  cat('shopping', 'Shopping', 'expense', '#FB8C00', 'shopping-bag'),
  cat('leisure', 'Leisure & culture', 'expense', '#FDD835', 'music'),
  cat('sport', 'Sport & fitness', 'expense', '#7CB342', 'activity'),
  cat('gifts-donations', 'Gifts & donations', 'expense', '#C0CA33', 'gift'),

  // Settling money already spent. Kept as expense categories, not transfers, so
  // they stay inside every total exactly as the source ledger counts them.
  cat('card-payment', 'Credit card payment', 'expense', '#7C3AED', 'credit-card'),
  cat('shared-costs', 'Shared costs', 'expense', '#0891B2', 'users'),

  // Money movement
  cat('taxes', 'Taxes', 'expense', '#546E7A', 'file-text'),
  cat('fees-interest', 'Bank fees & interest', 'expense', '#78909C', 'percent'),
  cat('savings', 'Savings & investments', 'expense', '#455A64', 'piggy-bank'),
  cat('cash', 'Cash withdrawals', 'expense', '#90A4AE', 'banknote'),
  cat('transfer-internal', 'Internal transfer', 'transfer', '#B0BEC5', 'arrow-left-right'),

  cat('uncategorised', 'Uncategorised', 'expense', '#9E9E9E', 'help-circle'),
];

export const UNCATEGORISED_ID = 'uncategorised';
export const INTERNAL_TRANSFER_ID = 'transfer-internal';

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(
  BUILT_IN_CATEGORIES.map((c) => [c.id, c]),
);
