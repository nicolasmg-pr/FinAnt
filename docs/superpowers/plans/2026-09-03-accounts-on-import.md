# Accounts On Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every CSV or camt.053 import asks which account the file belongs to, so a movement knows the account it came from and transfer matching (sub-project 4) can pair rows across accounts.

**Architecture:** The camt.053 reader additionally returns the account the statement names (`statementAccount`: IBAN and institution). The import screen keeps the picked file as a re-parseable `ParsedFile` and derives the preview from `file.parse(accountId)`, so changing the account re-runs the parse in memory and the import hashes always include the account that will be stored. An **Account** card above the preview offers existing accounts plus "New account"; preselection is camt IBAN match, then the last-used account (a new setting), then "My records". The spreadsheet import shows no picker and stays in "My records". The movements list appends the account name to a row's meta line once more than one account exists.

**Tech Stack:** TypeScript 6 strict, vitest for `packages/importers`, React Native 0.86, Expo SDK 57, expo-router, react-i18next, expo-sqlite. The mobile app has no test runner: verification there is typecheck + bundle export + simulator.

**Spec:** `docs/superpowers/specs/2026-09-03-ledger-control-design.md`, section "Sub-project 3 — accounts-on-import".

## Global Constraints

- Money is signed integer minor units plus an ISO 4217 code; never do float arithmetic on a balance.
- Dates are plain `YYYY-MM-DD` strings; a booking date never goes through a `Date`.
- Domain logic stays in `packages/core` and `packages/importers` with no React or Expo imports.
- Relative imports inside packages are extensionless (`'./values'`, never `'./values.js'`).
- Dedupe is enforced by the unique indexes `(account_id, import_hash)` and `(account_id, external_id)`. `importHashOf` includes the account id, so a draft must be produced for the account it will be stored in. Never patch `accountId` on a draft after parsing.
- Parsers report unreadable rows as issues and keep going; they do not throw.
- Translations are typed against `Resources`: every new key must land in `en.ts`, `es.ts` and `de.ts` or typecheck fails.
- Category ids are permanent; schema migrations are append-only. This sub-project adds no migration: `accounts.iban` already exists.
- `npm run lint:fix` reformats the whole repo. Run `npx prettier --write` and `npx eslint` only on the files you changed.
- Never log a movement, narrative, IBAN or any part of a statement. Never display an IBAN on screen either: the account is shown by name. Test fixtures are hand-written; the fixture IBAN `ES9121000418450200051332` is the published Spanish example IBAN, not a real account. No network calls, no telemetry.
- Never commit a real bank export. `fixtures/private/` is gitignored.
- Branch: `accounts-on-import` (already created off `main`). Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Baseline before this branch: `npm test` reports 125 tests passing; `npm run typecheck` exits 0.

## File map

| File | Responsibility in this plan |
|---|---|
| `packages/importers/src/camt053.ts` | Read `Stmt/Acct` into `statementAccount`; return type `Camt053Result` |
| `packages/importers/tests/fixtures/statement.camt053.xml` | Gains the servicing institution name |
| `packages/importers/tests/import.test.ts` | Tests for `statementAccount` |
| `apps/mobile/src/db/accounts-repo.ts` | `findAccountByIban`, `createAccount` with a caller-chosen id, "My records" identified as the oldest account |
| `apps/mobile/src/db/settings-repo.ts` | `SETTING_LAST_IMPORT_ACCOUNT` |
| `packages/i18n/src/{en,es,de}.ts` | `import.account`, `import.newAccount`, `import.accountName`, `import.accountRequired` |
| `apps/mobile/src/components/Chip.tsx` | Plain selectable pill (no category colour) |
| `apps/mobile/app/import.tsx` | Account card, re-parse per account, create account and remember it on confirm |
| `apps/mobile/src/hooks/use-app-data.ts` | Also loads `accounts` |
| `apps/mobile/app/(tabs)/transactions.tsx` | Meta line appends the account name when more than one account exists |
| `docs/import-formats.md`, `docs/data-model.md` | Account attribution |

---

### Task 1: camt.053 reports which account the statement belongs to

**Files:**
- Modify: `packages/importers/src/camt053.ts`
- Modify: `packages/importers/tests/fixtures/statement.camt053.xml`
- Test: `packages/importers/tests/import.test.ts`

**Interfaces:**
- Produces: `interface StatementAccount { readonly iban: string | null; readonly name: string | null }`, `interface Camt053Result extends ImportResult { readonly statementAccount: StatementAccount }`, and `parseCamt053(xml, context): Camt053Result`. Both are re-exported from `@finant/importers` through the existing `export * from './camt053'` in `src/index.ts`. The IBAN is returned compact: whitespace removed, upper case. Drafts still take `accountId` from `context`.

- [ ] **Step 1: Add the institution name to the fixture**

In `packages/importers/tests/fixtures/statement.camt053.xml`, replace the `<Acct>` line

```xml
      <Acct><Id><IBAN>ES9121000418450200051332</IBAN></Id><Ccy>EUR</Ccy></Acct>
```
with
```xml
      <Acct>
        <Id><IBAN>ES9121000418450200051332</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Svcr><FinInstnId><Nm>Banco de Pruebas</Nm></FinInstnId></Svcr>
      </Acct>
```

- [ ] **Step 2: Write the failing tests**

In `packages/importers/tests/import.test.ts`, inside `describe('parseCamt053', …)`, after the test `'reports a non-camt file as an issue instead of throwing'`, add:

```ts
  it('reads which account the statement belongs to', () => {
    expect(result.statementAccount).toEqual({
      iban: 'ES9121000418450200051332',
      name: 'Banco de Pruebas',
    });
  });

  it('returns an empty account when the statement does not name one', () => {
    const bare = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">' +
        '<BkToCstmrStmt><Stmt><Id>S-1</Id></Stmt></BkToCstmrStmt></Document>',
      ctx,
    );
    expect(bare.statementAccount).toEqual({ iban: null, name: null });
    expect(bare.issues).toHaveLength(0);

    const bad = parseCamt053('<html><body>nope</body></html>', ctx);
    expect(bad.statementAccount).toEqual({ iban: null, name: null });
  });

  it('compacts an IBAN written with spaces', () => {
    const spaced = parseCamt053(
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>' +
        '<Acct><Id><IBAN>es91 2100 0418 4502 0005 1332</IBAN></Id></Acct>' +
        '</Stmt></BkToCstmrStmt></Document>',
      ctx,
    );
    expect(spaced.statementAccount.iban).toBe('ES9121000418450200051332');
    expect(spaced.statementAccount.name).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
npx vitest run packages/importers/tests/import.test.ts
```
Expected: the three new tests fail (`statementAccount` is `undefined`); the existing tests pass. The typecheck is not part of vitest, so the failure is at runtime.

- [ ] **Step 4: Implement**

In `packages/importers/src/camt053.ts`, after the `date()` helper and before `export function parseCamt053`, add:

```ts
/** The account a camt.053 statement says it belongs to. Both fields are optional in the schema. */
export interface StatementAccount {
  /** Compact form: no whitespace, upper case. `null` when the statement omits it. */
  readonly iban: string | null;
  /** The servicing institution's name (`Acct/Svcr/FinInstnId/Nm`), when given. */
  readonly name: string | null;
}

export interface Camt053Result extends ImportResult {
  readonly statementAccount: StatementAccount;
}

const NO_ACCOUNT: StatementAccount = { iban: null, name: null };

function statementAccountOf(statement: Record<string, any> | undefined): StatementAccount {
  const account = statement?.['Acct'];
  const iban = text(account?.['Id']?.['IBAN']).replace(/\s+/g, '').toUpperCase();
  const name = text(account?.['Svcr']?.['FinInstnId']?.['Nm']);
  return { iban: iban || null, name: name || null };
}
```

Change the signature line

```ts
export function parseCamt053(xml: string, context: { accountId: string }): ImportResult {
```
to
```ts
export function parseCamt053(xml: string, context: { accountId: string }): Camt053Result {
```

In both early returns (the `Not valid XML` one and the `No camt.053 statement found` one), add `statementAccount: NO_ACCOUNT,` after `profileId: 'camt053',`.

Directly after the `statements.length === 0` guard (before `let index = 0;`), add:

```ts
  // A file may carry several Stmt blocks (one per period); they describe the
  // same account, so the first one names it. Multi-account files are not handled.
  const statementAccount = statementAccountOf(statements[0]);
```

Change the final return from

```ts
  return { profileId: 'camt053', transactions, issues };
```
to
```ts
  return { profileId: 'camt053', statementAccount, transactions, issues };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
npx vitest run packages/importers/tests/import.test.ts && npm run typecheck
```
Expected: all tests in the file pass (the camt block now has 7); typecheck exit 0. `apps/mobile/app/import.tsx` still compiles because `Camt053Result` is assignable to `ImportResult`.

- [ ] **Step 6: Format, lint, commit**

```bash
npx prettier --write packages/importers/src/camt053.ts packages/importers/tests/import.test.ts
npx eslint packages/importers/src/camt053.ts packages/importers/tests/import.test.ts
git add packages/importers/src/camt053.ts packages/importers/tests/import.test.ts packages/importers/tests/fixtures/statement.camt053.xml
git commit -m "feat(importers): camt.053 reports which account the statement belongs to

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Accounts repository — find by IBAN, create with a chosen id, remember the last import account

**Files:**
- Modify: `apps/mobile/src/db/accounts-repo.ts`
- Modify: `apps/mobile/src/db/settings-repo.ts`

**Interfaces:**
- Produces: `findAccountByIban(iban: string): Promise<AccountRow | null>`; `createAccount(account: { id?: string; name; currency; provider; iban?; institutionId?; institutionName? }): Promise<string>` (returns the id, which is the caller's when given); `SETTING_LAST_IMPORT_ACCOUNT = 'lastImportAccount'`.
- Unchanged: `listAccounts(): Promise<AccountRow[]>` (non-archived only), `getOrCreateLocalAccount(currency?): Promise<string>`.

Why `createAccount` takes an id: the import screen parses the file for the account it will land in **before** the account exists, because `import_hash` includes the account id. It generates the id up front, previews with it, and creates the account with that same id on confirm.

Why `getOrCreateLocalAccount` changes: every account created from the import screen carries `provider = 'file-import'`, so `WHERE provider = 'file-import' LIMIT 1` would pick an arbitrary one once there are two. "My records" is always the oldest: the import screen creates it before it offers "New account".

- [ ] **Step 1: Add the setting key**

In `apps/mobile/src/db/settings-repo.ts`, after `export const SETTING_APP_LOCK = 'appLock';` add:

```ts
/** Account id preselected on the import screen: the one the last import went to. */
export const SETTING_LAST_IMPORT_ACCOUNT = 'lastImportAccount';
```

- [ ] **Step 2: Extend the accounts repository**

In `apps/mobile/src/db/accounts-repo.ts`, after `listAccounts`, add:

```ts
/** Exact match on the compact IBAN the camt.053 reader returns (no spaces, upper case). */
export async function findAccountByIban(iban: string): Promise<AccountRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AccountRow>(
    'SELECT * FROM accounts WHERE iban = ? AND archived = 0 LIMIT 1;',
    iban,
  );
  return row ?? null;
}
```

Replace the whole `createAccount` function with:

```ts
export async function createAccount(account: {
  /** Chosen by the caller when rows were already hashed for it; generated otherwise. */
  id?: string;
  name: string;
  currency: string;
  provider: string;
  iban?: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = account.id ?? newId();
  await db.runAsync(
    `INSERT INTO accounts (
       id, name, iban, currency, institution_id, institution_name, provider, archived, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?);`,
    id,
    account.name,
    account.iban ?? null,
    account.currency,
    account.institutionId ?? null,
    account.institutionName ?? null,
    account.provider,
    new Date().toISOString(),
  );
  return id;
}
```

Replace the whole `getOrCreateLocalAccount` function with:

```ts
/**
 * The account every manual entry and untyped import lands in. Created lazily so
 * a fresh install has no rows at all.
 *
 * Accounts the owner adds on the import screen share `provider = 'file-import'`,
 * so "My records" is identified as the oldest: the import screen calls this
 * before it offers "New account", so nothing can be created ahead of it.
 */
export async function getOrCreateLocalAccount(currency = 'EUR'): Promise<string> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE provider = 'file-import' ORDER BY created_at ASC LIMIT 1;`,
  );
  if (existing) return existing.id;
  return createAccount({ name: 'My records', currency, provider: 'file-import' });
}
```

- [ ] **Step 3: Typecheck, lint**

Run:
```bash
npm run typecheck
npx prettier --write apps/mobile/src/db/accounts-repo.ts apps/mobile/src/db/settings-repo.ts
npx eslint apps/mobile/src/db/accounts-repo.ts apps/mobile/src/db/settings-repo.ts
```
Expected: exit 0 for all three.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/db/accounts-repo.ts apps/mobile/src/db/settings-repo.ts
git commit -m "feat(db): find an account by IBAN, create one with a chosen id, remember the last import account

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Shared pieces — account strings and a plain Chip

**Files:**
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/es.ts`, `packages/i18n/src/de.ts`
- Create: `apps/mobile/src/components/Chip.tsx`

**Interfaces:**
- Produces: translation keys `import.account`, `import.newAccount`, `import.accountName`, `import.accountRequired`; component `Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void })`.

`CategoryChip` is not reused: it takes a `Category` and paints its colour dot. An account has no category colour, so a plain pill with the same shape is a new small component rather than an optional prop that makes `CategoryChip` lie about its input.

- [ ] **Step 1: English**

In `packages/i18n/src/en.ts`, inside `import: { … }`, after `imported_other: '{{count}} movements imported',` add:

```ts
    account: 'Account',
    newAccount: 'New account',
    accountName: 'Account name',
    accountRequired: 'Give the new account a name.',
```

- [ ] **Step 2: Spanish**

In `packages/i18n/src/es.ts`, inside `import: { … }`, after `imported_other: '{{count}} movimientos importados',` add:

```ts
    account: 'Cuenta',
    newAccount: 'Cuenta nueva',
    accountName: 'Nombre de la cuenta',
    accountRequired: 'Pon un nombre a la cuenta nueva.',
```

- [ ] **Step 3: German**

In `packages/i18n/src/de.ts`, inside `import: { … }`, after `imported_other: '{{count}} Umsätze importiert',` add:

```ts
    account: 'Konto',
    newAccount: 'Neues Konto',
    accountName: 'Kontoname',
    accountRequired: 'Gib dem neuen Konto einen Namen.',
```

- [ ] **Step 4: The Chip component**

Create `apps/mobile/src/components/Chip.tsx`:

```tsx
import { Pressable, StyleSheet, Text } from 'react-native';
import { radius, spacing, useTheme } from '../theme';

/** A plain selectable pill: label only, outlined in the accent colour when chosen. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.accent : theme.border,
          backgroundColor: selected ? theme.surfaceAlt : 'transparent',
        },
      ]}
    >
      <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
```

- [ ] **Step 5: Typecheck, lint, commit**

Run:
```bash
npm run typecheck
npx prettier --write packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/src/components/Chip.tsx
npx eslint packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/src/components/Chip.tsx
```
Expected: exit 0. A missing key in `es.ts` or `de.ts` fails typecheck with a `Translations` assignment error; fix the key rather than the type.

```bash
git add packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/src/components/Chip.tsx
git commit -m "feat(mobile): account strings and a plain Chip for the import screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The import screen chooses the account a file lands in

**Files:**
- Modify: `apps/mobile/app/import.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `parseCamt053(text, { accountId }): Camt053Result` and `type StatementAccount`, `type ImportResult` from `@finant/importers` (Task 1); `createAccount({ id, … })`, `findAccountByIban`, `getOrCreateLocalAccount`, `listAccounts`, `type AccountRow` from `src/db/accounts-repo` (Task 2); `readSetting`, `writeSetting`, `SETTING_LAST_IMPORT_ACCOUNT` from `src/db/settings-repo` (Task 2); `newId` from `src/db/transactions-repo`; `Chip` (Task 3); strings `import.account`, `import.newAccount`, `import.accountName`, `import.accountRequired` (Task 3).

Behaviour to implement, from the spec:

1. After a CSV or camt file is parsed, an **Account** card appears above the preview: one `Chip` per non-archived account plus a "New account" chip that reveals a name field.
2. Preselection: the account whose `iban` equals the camt `statementAccount.iban`; else the account in `SETTING_LAST_IMPORT_ACCOUNT` if it still exists; else "My records".
3. Changing the selection re-runs the parse with the new account id, so preview and hashes match what will be stored. For "New account" the id is generated when the chip is tapped and reused on confirm.
4. The `.xlsx` tracker shows no picker and lands in "My records".
5. On confirm: create the account if "New account" (with the camt IBAN and institution name when known, so the next statement from that bank preselects it), write the setting (only when a picker was shown), then `ingest`. The result card stays as it is.

Design notes for the implementer:

- `ParsedFile` holds `parse: (accountId) => ImportResult` instead of the rows. `staged` is a `useMemo` over `file` and `choice`. Parsing a few thousand rows in memory is well under a frame; no debounce.
- The camt reader is run once with the local account id only to read `statementAccount` ("probe"); the rows it produced are discarded. That probe is not a separate code path: the same `parse` closure serves both.
- Never render `statementAccount.iban`. It is used for matching and stored on a new account, nothing else. The institution name is a fair default for the new account's name field.
- Accepted gap: if `createAccount` succeeds and `ingest` then throws, the new account exists with no rows. The owner sees the error and can import again into it; nothing is duplicated.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `apps/mobile/app/import.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  applyProfile,
  BUILT_IN_PROFILES,
  detectProfile,
  GENERIC_CSV,
  importWorkbook,
  parseCamt053,
  PRESUPUESTO_XLSX,
  readCsv,
  readXlsx,
  yearFromFileName,
  type ImportProfile,
  type ImportResult,
  type StatementAccount,
} from '@finant/importers';
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import {
  createAccount,
  findAccountByIban,
  getOrCreateLocalAccount,
  listAccounts,
  type AccountRow,
} from '../src/db/accounts-repo';
import { readSetting, SETTING_LAST_IMPORT_ACCOUNT, writeSetting } from '../src/db/settings-repo';
import { newId } from '../src/db/transactions-repo';
import { ingest, type IngestResult } from '../src/services/ingest';
import { radius, spacing, useTheme } from '../src/theme';

/**
 * A picked file once its format is known, but before its rows are final. The
 * import hash of every row includes the account id, so the file is parsed
 * again (in memory, from the same text) whenever the owner picks another
 * account. The preview then shows exactly what the database will hold.
 */
interface ParsedFile {
  fileName: string;
  /** Human-readable name of the format that was used. */
  formatLabel: string;
  parse: (accountId: string) => ImportResult;
  /** The account the statement itself names. camt.053 only; null for CSV and xlsx. */
  statementAccount: StatementAccount | null;
  /** The tracker spreadsheet is the owner's own ledger: always "My records", no picker. */
  fixedToLocal: boolean;
}

/** The account the import will land in. `isNew` means it is created on confirm. */
interface AccountChoice {
  readonly id: string;
  readonly isNew: boolean;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Reads the picked file and works out how to parse it. `probeAccountId` is
 * only used to run the camt.053 reader once for its `statementAccount`; the
 * rows from that run are discarded.
 */
async function parseFile(
  asset: { uri: string; name: string },
  probeAccountId: string,
  forcedProfile: ImportProfile | undefined,
): Promise<ParsedFile> {
  const file = new File(asset.uri);
  const bytes = await file.bytes();

  // An .xlsx is a zip, so it is detected by the archive magic bytes rather
  // than by a filename extension or a MIME type the picker may not set.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const workbook = readXlsx(bytes);
    const year = yearFromFileName(asset.name);
    return {
      fileName: asset.name,
      formatLabel: `${PRESUPUESTO_XLSX.label} · ${year}`,
      parse: (accountId) => importWorkbook(workbook, PRESUPUESTO_XLSX, { accountId, year }),
      statementAccount: null,
      fixedToLocal: true,
    };
  }

  const text = await file.text();

  if (text.trimStart().startsWith('<')) {
    const parse = (accountId: string) => parseCamt053(text, { accountId });
    return {
      fileName: asset.name,
      formatLabel: 'camt.053',
      parse,
      statementAccount: parse(probeAccountId).statementAccount,
      fixedToLocal: false,
    };
  }

  const profile =
    forcedProfile ?? detectProfile(readCsv(text).header, BUILT_IN_PROFILES) ?? GENERIC_CSV;
  const table = readCsv(text, { headerRow: profile.headerRow ?? 0 });
  return {
    fileName: asset.name,
    formatLabel: profile.label,
    parse: (accountId) => applyProfile(table, profile, { accountId }),
    statementAccount: null,
    fixedToLocal: false,
  };
}

/** Statement IBAN first, then the account the last import went to, then "My records". */
async function preselect(
  file: ParsedFile,
  known: readonly AccountRow[],
  localId: string,
): Promise<AccountChoice> {
  if (file.fixedToLocal) return { id: localId, isNew: false };
  const iban = file.statementAccount?.iban;
  if (iban) {
    const match = await findAccountByIban(iban);
    if (match) return { id: match.id, isNew: false };
  }
  const lastUsed = await readSetting(SETTING_LAST_IMPORT_ACCOUNT);
  if (lastUsed && known.some((account) => account.id === lastUsed)) {
    return { id: lastUsed, isNew: false };
  }
  return { id: localId, isNew: false };
}

/**
 * File import. Everything happens on the device: the picked file is read from
 * local storage, parsed in memory, and written to the encrypted database.
 * Nothing is uploaded.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [choice, setChoice] = useState<AccountChoice | null>(null);
  const [newAccountName, setNewAccountName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  // Parsed for the chosen account, so the hashes in the preview are the ones stored.
  const staged = useMemo(() => (file && choice ? file.parse(choice.id) : null), [file, choice]);
  const needsName = choice?.isNew === true && newAccountName.trim() === '';

  const pick = async (forcedProfile?: ImportProfile) => {
    setError(null);
    setResult(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        XLSX_MIME,
        'text/csv',
        'text/comma-separated-values',
        'text/xml',
        'application/xml',
        'text/plain',
        '*/*',
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setBusy(true);
    try {
      // "My records" must exist before any other account can be offered or
      // created; see getOrCreateLocalAccount.
      const localId = await getOrCreateLocalAccount();
      const known = await listAccounts();
      const parsed = await parseFile(asset, localId, forcedProfile);
      setAccounts(known);
      // A statement that names its bank gives the new-account field a sensible default.
      setNewAccountName(parsed.statementAccount?.name ?? '');
      setChoice(await preselect(parsed, known, localId));
      setFile(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseNew = () =>
    setChoice((current) => (current?.isNew ? current : { id: newId(), isNew: true }));

  const confirm = async () => {
    if (!file || !staged || !choice || needsName) return;
    setBusy(true);
    try {
      if (choice.isNew) {
        await createAccount({
          id: choice.id,
          name: newAccountName.trim(),
          currency: staged.transactions[0]?.amount.currency ?? 'EUR',
          provider: 'file-import',
          // Stored so the next statement from this bank preselects the account.
          iban: file.statementAccount?.iban ?? null,
          institutionName: file.statementAccount?.name ?? null,
        });
      }
      if (!file.fixedToLocal) await writeSetting(SETTING_LAST_IMPORT_ACCOUNT, choice.id);
      // Stay on screen: the owner should see how many rows were new and how
      // many the unique indexes already held before the modal closes.
      setResult(await ingest(staged.transactions));
      setFile(null);
      setChoice(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Card title={t('import.title')}>
        <Pressable
          onPress={() => void pick()}
          disabled={busy}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>{t('import.pickFile')}</Text>
        </Pressable>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('import.supportedFormats')}</Text>
        {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
      </Card>

      {result ? (
        <Card title={t('import.result')}>
          <Text style={{ color: theme.text }}>{t('import.imported', { count: result.inserted })}</Text>
          {result.duplicates > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.duplicatesSkipped', { count: result.duplicates })}
            </Text>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            style={[styles.button, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>{t('common.done')}</Text>
          </Pressable>
        </Card>
      ) : null}

      {file && !file.fixedToLocal ? (
        <Card title={t('import.account')}>
          <View style={styles.chips}>
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={account.name}
                selected={choice?.id === account.id}
                onPress={() => setChoice({ id: account.id, isNew: false })}
              />
            ))}
            <Chip label={t('import.newAccount')} selected={choice?.isNew === true} onPress={chooseNew} />
          </View>
          {choice?.isNew ? (
            <>
              <TextInput
                value={newAccountName}
                onChangeText={setNewAccountName}
                placeholder={t('import.accountName')}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
                ]}
              />
              {needsName ? (
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {t('import.accountRequired')}
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {file && staged ? (
        <>
          <Card
            title={t('import.preview')}
            subtitle={t('import.detectedProfile', { profile: file.formatLabel })}
          >
            <Text style={{ color: theme.text }}>
              {t('import.rowsReady', { count: staged.transactions.length })}
            </Text>
            {staged.issues.length > 0 ? (
              <Text style={{ color: theme.warning }}>
                {t('import.issues', { count: staged.issues.length })}
              </Text>
            ) : null}

            {staged.transactions.slice(0, 8).map((draft) => (
              <View key={draft.importHash} style={[styles.row, { borderBottomColor: theme.border }]}>
                <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
                  {draft.bookingDate} · {draft.description}
                </Text>
                <Amount value={draft.amount} />
              </View>
            ))}

            <Pressable
              onPress={() => void confirm()}
              disabled={busy || needsName || staged.transactions.length === 0}
              style={[
                styles.button,
                { backgroundColor: theme.accent, opacity: busy || needsName ? 0.6 : 1 },
              ]}
            >
              <Text style={styles.buttonText}>{t('import.confirm')}</Text>
            </Pressable>
          </Card>

          {staged.issues.length > 0 ? (
            <Card title={t('import.issues', { count: staged.issues.length })}>
              {staged.issues.slice(0, 10).map((issue) => (
                <Text key={`${issue.row}`} style={{ color: theme.textMuted, fontSize: 12 }}>
                  {issue.row}: {issue.message}
                </Text>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
```

- [ ] **Step 2: Typecheck and lint**

Run:
```bash
npm run typecheck
npx prettier --write apps/mobile/app/import.tsx
npx eslint apps/mobile/app/import.tsx
```
Expected: exit 0. If typecheck complains that `bytes[0]` is `number | undefined`, that is `noUncheckedIndexedAccess` working; the `===` comparison against a number is still valid and needs no change.

- [ ] **Step 3: Bundle check**

Run:
```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/cb425b32-b661-4d2e-bf1d-c23971324b9b/scratchpad/export && cd ../..
```
Expected: an "Exported" summary and no error. This catches a Metro resolution problem (for example an import with a `.js` extension) that `tsc` does not.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/import.tsx
git commit -m "feat(import): choose the account a file lands in

The import hash includes the account id, so the file is parsed again for the
chosen account and the preview shows what will be stored. camt.053 statements
preselect the account with their IBAN; CSVs preselect the last-used account.
The tracker workbook stays in My records.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The movements list names the account when there is more than one

**Files:**
- Modify: `apps/mobile/src/hooks/use-app-data.ts`
- Modify: `apps/mobile/app/(tabs)/transactions.tsx`

**Interfaces:**
- Consumes: `listAccounts(): Promise<AccountRow[]>` and `type AccountRow` from `src/db/accounts-repo`.
- Produces: `useAppData()` additionally returns `accounts: AccountRow[]`, loaded in the same `reload`. Existing consumers (dashboard, budgets) are unaffected: the field is additive.

The detail screen already shows the account name (sub-project 1 read it from `listAccounts`); nothing to do there.

- [ ] **Step 1: Load accounts with the ledger**

Replace the entire contents of `apps/mobile/src/hooks/use-app-data.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { Transaction } from '@finant/core';
import { listAccounts, type AccountRow } from '../db/accounts-repo';
import { listAllTransactions } from '../db/transactions-repo';

interface AppData {
  transactions: Transaction[];
  /** Non-archived accounts, so screens can name where a movement came from. */
  accounts: AccountRow[];
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

/**
 * Loads the whole ledger once and hands it to the screens.
 *
 * A personal history is a few thousand rows; aggregating it in memory keeps
 * every chart consistent with the movements list, and avoids a second set of
 * SQL aggregates that could quietly disagree with the domain code.
 */
export function useAppData(): AppData {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [rows, known] = await Promise.all([listAllTransactions(), listAccounts()]);
      setTransactions(rows);
      setAccounts(known);
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { transactions, accounts, loading, error, reload };
}
```

- [ ] **Step 2: Show the account name in the row meta**

In `apps/mobile/app/(tabs)/transactions.tsx`:

Change
```ts
  const { transactions, loading, reload } = useAppData();
```
to
```ts
  const { transactions, accounts, loading, reload } = useAppData();
```

After the `visible` memo, add:

```ts
  // One account needs no label; the name only helps once there is something to tell apart.
  const accountNames = useMemo(
    () => (accounts.length > 1 ? new Map(accounts.map((a) => [a.id, a.name])) : null),
    [accounts],
  );
```

Change
```tsx
        renderItem={({ item }) => <Row transaction={item} />}
```
to
```tsx
        renderItem={({ item }) => (
          <Row transaction={item} accountName={accountNames?.get(item.accountId) ?? null} />
        )}
```

Change the `Row` signature from
```tsx
function Row({ transaction }: { transaction: Transaction }) {
```
to
```tsx
function Row({
  transaction,
  accountName,
}: {
  transaction: Transaction;
  accountName: string | null;
}) {
```

After the line `if (transaction.excludedFromStats) meta.push(t('transactions.excludedTag'));` add:

```ts
  if (accountName) meta.push(accountName);
```

- [ ] **Step 3: Typecheck, lint, commit**

Run:
```bash
npm run typecheck
npx prettier --write apps/mobile/src/hooks/use-app-data.ts "apps/mobile/app/(tabs)/transactions.tsx"
npx eslint apps/mobile/src/hooks/use-app-data.ts "apps/mobile/app/(tabs)/transactions.tsx"
```
Expected: exit 0.

```bash
git add apps/mobile/src/hooks/use-app-data.ts "apps/mobile/app/(tabs)/transactions.tsx"
git commit -m "feat(mobile): movements list names the account once there is more than one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs — how an import is attributed to an account

**Files:**
- Modify: `docs/import-formats.md`
- Modify: `docs/data-model.md`

- [ ] **Step 1: Import formats**

In `docs/import-formats.md`, append at the end of the file (after the camt.053 section):

```markdown
## Which account a file lands in

Every import is attributed to one account, chosen on the import screen before
the rows are written. The dedupe indexes are per account (see
`docs/data-model.md`), and `import_hash` includes the account id, so the screen
parses the file again whenever the owner picks another account: the preview
shows the rows exactly as the database will hold them, never rows hashed for
one account and stored in another.

- **camt.053** names its own account. `Stmt/Acct/Id/IBAN` and the servicing
  institution `Stmt/Acct/Svcr/FinInstnId/Nm` come back as `statementAccount`
  (IBAN compacted: no spaces, upper case). An existing account with that IBAN is
  preselected. When the owner creates a new account for the file, the IBAN and
  institution name are stored on it, so the next statement from that bank finds
  its account by itself. The IBAN is never shown on screen; accounts are named.
- **CSV** carries no account identity. The account the last import went to
  (`lastImportAccount` in `settings`) is preselected, then "My records".
- **The Presupuesto workbook** always lands in "My records" and shows no picker.
  It is the owner's own ledger, not a bank's statement.
```

- [ ] **Step 2: Data model**

In `docs/data-model.md`, under `## Tables`, replace the `accounts` bullet

```markdown
- `accounts` — one row per bank account the owner imports statements for, plus
  one local "My records" account that owns manual entries and untyped imports.
  Migration 3 dropped the aggregator consent columns; `provider` now only ever
  holds a `TransactionSource`.
```
with
```markdown
- `accounts` — one row per bank account the owner imports statements for, plus
  one local "My records" account that owns manual entries and the tracker
  workbook. Every one of them has `provider = 'file-import'`; "My records" is
  the oldest, created before the import screen can offer "New account". `iban`
  is set when the account was created from a camt.053 statement and is how the
  next statement from that bank preselects it. Migration 3 dropped the
  aggregator consent columns; `provider` now only ever holds a
  `TransactionSource`.
```

and replace the `settings` bullet

```markdown
- `settings` — key/value: locale, main currency, app lock.
```
with
```markdown
- `settings` — key/value: locale, main currency, app lock, last import account.
```

- [ ] **Step 3: Format and commit**

```bash
npx prettier --write docs/import-formats.md docs/data-model.md
git add docs/import-formats.md docs/data-model.md
git commit -m "docs: how an import is attributed to an account

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Verify on device and finish the branch

**Files:** none new.

- [ ] **Step 1: Full checks**

Run:
```bash
npm run typecheck && npm test
```
Expected: typecheck exit 0; vitest reports 128 tests passing (125 before this branch plus the three camt tests from Task 1).

- [ ] **Step 2: Bundle check**

Run:
```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/cb425b32-b661-4d2e-bf1d-c23971324b9b/scratchpad/export && cd ../..
```
Expected: "Exported" summary, no error.

- [ ] **Step 3: Run in the simulator**

Run (background, it takes minutes):
```bash
cd apps/mobile && npx expo run:ios
```
When the app is up, screenshot the Movements tab:
```bash
xcrun simctl io booted screenshot /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/cb425b32-b661-4d2e-bf1d-c23971324b9b/scratchpad/movements.png
```
Scripted taps are not available on this Mac (Accessibility denied for osascript), so the owner verifies the flow by hand:

1. Import a CSV. The Account card shows "My records" selected. Import it.
2. Import a second CSV, tap "New account", leave the name empty: the hint "Give the new account a name." appears and Import is dimmed. Type a name, import.
3. Open the Movements tab: rows from the second file end their meta line with the new account's name; open one and the detail's "Account" field shows the same name.
4. Import a third file: the new account is preselected (last used).
5. Import the camt.053 fixture-shaped statement, if one is at hand, into a new account, then import it again: the same account is preselected by IBAN and every row reports as a duplicate.
6. Import the Presupuesto workbook: no Account card is shown.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`. The agreed flow is: merge `accounts-on-import` into `main` with a `--no-ff` merge commit whose subject starts with `merge:`, keep the branch, then the owner pushes. Pushing from this session is blocked by the permission classifier; the owner runs:

```bash
git push origin main accounts-on-import
```
