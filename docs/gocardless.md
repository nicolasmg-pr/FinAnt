# GoCardless Bank Account Data (ex-Nordigen)

Source: https://developer.gocardless.com/bank-account-data — read 2026-08-31.
Free AIS (account information) API covering banks across the EEA and the UK.
It is read-only: there is no payment-initiation scope in this product.

Base URL: `https://bankaccountdata.gocardless.com/api/v2`

## Authentication

```
POST /token/new/          { secret_id, secret_key }  -> { access, access_expires, refresh, refresh_expires }
POST /token/refresh/      { refresh }                -> { access, access_expires }
```

- `access` lives ~24h, `refresh` ~30 days.
- `secret_id` / `secret_key` belong to a GoCardless **account**, not to an end
  user. One leaked pair exposes every bank connection made under that account.
  See `security-model.md` for how they are held on device and what has to change
  before the app is distributed to other people.

## Connecting a bank

1. `GET /institutions/?country=es` — list banks for a country (ISO 3166 alpha-2,
   lowercase). Each entry carries `transaction_total_days`, the maximum history
   that institution will return; asking for more is rejected.
2. `POST /agreements/enduser/` — `{ institution_id, max_historical_days,
   access_valid_for_days, access_scope: ["balances","details","transactions"] }`.
3. `POST /requisitions/` — `{ redirect, institution_id, agreement, user_language }`
   returns `{ id, link }`. Open `link` in a browser; the user authenticates with
   their own bank and is sent back to `redirect`.
4. `GET /requisitions/{id}/` — after consent, `accounts` holds the account ids.
5. `GET /accounts/{id}/details/` — IBAN, currency, product name.

`redirect` must be registered in the GoCardless dashboard. FinAnt uses the app
scheme `finant://bank-callback`.

## Reading movements

```
GET /accounts/{id}/transactions/?date_from=YYYY-MM-DD
```

Returns `{ transactions: { booked: [...], pending: [...] } }`.

Fields used by FinAnt:

| Field | Notes |
|---|---|
| `transactionId` | Provider id. Primary dedupe key. Absent at some banks. |
| `internalTransactionId` | Fallback id. Can change between syncs at some banks. |
| `bookingDate` | Calendar date, `YYYY-MM-DD`. Drives every monthly aggregate. |
| `valueDate` | Settlement date. Stored, not aggregated on. |
| `transactionAmount` | `{ amount: "-52.40", currency: "EUR" }` — signed decimal string. |
| `creditorName` / `debtorName` | Counterparty, depending on direction. |
| `remittanceInformationUnstructured(Array)` | The narrative. Array form at several banks. |

Only `booked` entries are stored. Pending entries change amount and text before
they settle and would import as near-duplicates.

## Quotas and failure modes

- **Rate limit**: most institutions allow ~4 transaction calls per account per
  day. Exceeding it returns **429**; retrying immediately spends tomorrow's quota.
- **Consent expiry**: agreements last up to 180 days (90 at many banks). After
  that the endpoints return **403** and the user must re-run the consent flow.
- **401** means the credentials were rejected — not that the consent lapsed.
