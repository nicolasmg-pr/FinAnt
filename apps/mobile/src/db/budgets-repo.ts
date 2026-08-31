import type { Budget } from '@finant/core';
import { getDatabase } from './database';
import { toBudget, type BudgetRow } from './mappers';

export async function listBudgets(): Promise<Budget[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BudgetRow>('SELECT * FROM budgets ORDER BY category_id ASC;');
  return rows.map(toBudget);
}

/**
 * Upserts the single budget a category can have. The table is keyed on
 * `category_id`, so editing a limit and creating one are the same statement.
 */
export async function saveBudget(budget: Budget): Promise<void> {
  if (budget.monthlyLimit.minor <= 0) {
    throw new RangeError('A budget limit must be a positive amount');
  }
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO budgets (category_id, limit_minor, currency) VALUES (?, ?, ?)
     ON CONFLICT(category_id) DO UPDATE SET
       limit_minor = excluded.limit_minor,
       currency = excluded.currency;`,
    budget.categoryId,
    budget.monthlyLimit.minor,
    budget.monthlyLimit.currency,
  );
}

export async function deleteBudget(categoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM budgets WHERE category_id = ?;', categoryId);
}
