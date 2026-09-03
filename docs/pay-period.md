# Pay period

The dashboard's first card and the budgets screen report on a _pay period_,
not a calendar month: from the owner's last salary booking up to today.
Salary lands around the 28th; on a calendar month every figure from the 1st to
the 27th reads as debt.

Code: `packages/core/src/period.ts`; `summarisePeriod` in `aggregate.ts`;
`budgetPeriod` in `budget.ts`; `apps/mobile/src/hooks/use-pay-period.ts`.

## What anchors a period

A movement opens a period when its category is `income-salary` and it counts
toward statistics (not excluded by the owner, not an internal transfer). The
booking date is the boundary. Salary drifts with weekends and holidays; using
the real booking date absorbs that with no setting to maintain. There is no
payroll flag or column: categorising a movement as Salary is the marker, and a
learned rule keeps future payrolls landing there.

## Merge window

Two salary bookings within `PAYROLL_MERGE_DAYS` (14 days, inclusive) of each
other count as one: the earlier one opens the period and the later one is
dropped. A bonus paid a week after payroll, or two employers paying days apart,
must not split the month in two.

## Open and closed ends

`Period.to` is `null` while the period is open (no later salary yet), so the
current period runs to the end of the ledger. Once a later salary exists, `to`
is the day before it. Both ends are inclusive.

## Fallback

With no salary booked on or before today, the period is the calendar month:
`from` is the first of the month, `to` is open, `anchored` is `false`, and the
card title reads "This month" instead of "Since 28 Aug".

## Spreadsheet history

Years imported from the tracker workbook book every row on the 1st, salary
included, so their periods are calendar months. Consistent with the fallback.

## Why the forecast ignores it

The year forecast stays on calendar months. An annual projection has no pay
date, and its history is sampled month by month.

## Budgets

Budget limits are monthly and are applied to a pay period as-is. Pro-rating to
29 or 33 days would move the bar for reasons the owner cannot see.
