# Investments — design

Status: approved 2026-09-11. Branch `investments`.

FinAnt reads the trade rows already present in a bank export, rebuilds the
portfolio they describe, and values it against live quotes. It is the first
feature in the app that touches the network.

## Why this needs a design

Three things in the existing codebase do not survive contact with a trade row:

1. `Money` is integer minor units at two decimals. A share count is
   `0.7618080000` and a unit price `17.742000`. Neither fits.
2. `DraftTransaction` has no asset, share count, or unit price, and
   `ImportProfile` has no way to say where those columns are.
3. `countsTowardStats` treats every negative amount as spending, so a month
   with EUR 2,000 of purchases reads as a EUR 2,000 spending blowout and the
   forecast learns from it.

And one thing in `CLAUDE.md` does not survive it either: *"no network calls at
all. The app has no external host to talk to."* That boundary is rewritten by
this feature, narrowly and explicitly (see Boundary).

## Source format

Trade Republic's CSV export. Real file lives at
`fixtures/private/trade-republic-export.csv`, gitignored; the layout is
documented in `docs/import-formats.md` and test fixtures are hand-written from
that documentation, never copied from the real file.

Columns that matter: `date`, `category`, `type`, `asset_class`, `name`,
`symbol`, `shares`, `price`, `amount`, `fee`, `currency`, `transaction_id`.

### Row vocabulary

Mapped explicitly. No heuristics on narrative text — a wrong guess here
invents or loses shares, which is the worst place in the app to be wrong.

| `type` | Side | Category | Leg |
| --- | --- | --- | --- |
| `BUY` | expense | `investment-trade` | yes |
| `SELL` | income | `investment-trade` | yes, negative shares |
| `DIVIDEND` | income | `income-investment` | **no** |
| `BENEFITS_SAVEBACK` | income | `income-investment` | **no** |
| `STOCKPERK` | income | `income-investment` | **no** |
| anything else | today's normal path | | no |

Two traps the real export exposes, both confirmed against it:

- On a `DIVIDEND` row, `shares` is the holding **at the time of payment**, not
  shares acquired. Adding it to the position silently inflates the holding.
- `BENEFITS_SAVEBACK` and `STOCKPERK` credit cash with an asset named but
  `shares` empty. Trade Republic books a **separate** `BUY` moments later that
  carries the shares. Treating the credit as an acquisition double-counts.

## Value types

`Money` gains a sibling rather than a change. Integer arithmetic only, same
discipline, in `packages/core/src/decimal.ts`:

```ts
export interface Decimal {
  readonly scaled: number;
  readonly scale: number;
}
export const SHARE_SCALE = 10;
export const PRICE_SCALE = 10;
```

Ceiling is `Number.MAX_SAFE_INTEGER / 1e10` ~= 900,719 units. A share count or
unit price beyond it is reported as an import issue, never silently wrapped —
the same rule the parsers already follow for an unreadable row.

**Cost basis comes from the `amount` column, never `price * shares`.** `amount`
is already exact two-decimal `Money`; multiplying two scaled decimals invents
rounding error in the one number that has to be right.

## Domain model

`Asset` (owner-editable name, never auto-renamed, per the no-auto-created-
entities rule), `InvestmentLeg` (one acquisition or disposal, pointing at the
cash `Transaction` that paid for it), and derived `Holding` / `Portfolio`.

Holdings are **derived from legs on read**, not materialised. One source of
truth, nothing to drift after an edit or re-import, and `packages/core` stays
pure. The real file is 133 legs; summing is free.

## Aggregates

New built-in category `investment-trade`, kind `transfer`, permanent id. One
guard changes:

```ts
return !tx.excludedFromStats
  && tx.categoryId !== 'transfer-internal'
  && tx.categoryId !== 'investment-trade';
```

A purchase is cash converted into an asset, not spending: net worth is
unchanged, so the monthly figures must be too. `excludedFromStats` keeps its
existing meaning — the owner flagged this by hand — and is not overloaded.

Dividends, savebacks and stockperks stay income. They are genuinely new money.

## Prices

`PriceProvider` is an interface in `packages/core` and performs no I/O. Adapters
live in `apps/mobile/src/services/prices/`:

- `yahoo.ts` — `v1/finance/search?q=<ISIN>` resolves ISIN to a listing symbol,
  `v8/finance/chart/<symbol>` returns `regularMarketPrice` and `currency`.
  Unofficial endpoints: Yahoo retired its public API in 2017 and these are what
  its own web client uses. They work, they can break, and the adapter treats a
  failure as a stale-cache render rather than an error screen.
- `coingecko.ts` — `simple/price` for crypto.

A manual price per asset always overrides, so the feature degrades to fully
offline when a provider dies or the owner prefers it.

Quotes are cached in SQLite with an `asOf` timestamp. The screen **always
renders from cache**, offline, with the timestamp visible. Refresh when the
cache is older than 15 minutes on open, and on pull-to-refresh. No background
traffic.

## Computation

Position is the sum of its legs. Average cost drives the display line; realised
gain on a disposal is **FIFO**, which matches German tax treatment. Allocation
by asset and by asset class. Dividend totals per asset and per year.

## UI

A portfolio block inside the existing Banks tab — that screen already answers
"what do I hold", and this keeps holdings beside the cash that bought them
without a sixth tab. Per-asset detail at `app/portfolio/[assetId].tsx`.
Portfolio value joins the net-worth total. Strings typed against `Resources` in
en/es/de, so a missing key is a compile error.

## Value over time

Daily history per asset into a `price_history` table, backfilled from the first
trade, plotted alongside the existing net-worth line. By far the heaviest piece
— it needs per-asset historical series rather than one quote each — so it lands
last, after everything above is confirmed working.

## Boundary

`CLAUDE.md` is rewritten from "no network calls at all" to permit exactly one
call shape:

> The app makes one kind of network call: a quote lookup for the symbols held
> in the portfolio, when the owner opens or refreshes that screen. It sends
> symbols only. No amount, share count, balance, account, IBAN, narrative or
> movement ever leaves the device. Still no analytics, no crash reporting, no
> telemetry, and no other host.

The privacy cost is real and worth stating plainly: the quote provider learns
which securities the owner holds. It does not learn how many, what they cost,
or what else is in the account.

## Testing

TDD throughout. Fixtures hand-written from `docs/import-formats.md`. The cases
that matter: ten-decimal share arithmetic, basis taken from `amount` rather
than `price * shares`, a dividend adding no shares, a saveback adding no
shares, FIFO across a disposal, the 900,719 ceiling raising an issue instead of
wrapping, and purchases dropping out of the monthly totals.
