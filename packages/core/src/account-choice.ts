/**
 * Which bank and which account a file import — or a movement typed by hand —
 * lands in.
 *
 * A bank groups accounts (see `docs/data-model.md`), so the owner picks the
 * bank first and the account inside it second. Either may still have to be
 * created, which is why a choice carries the names as well as the ids: nothing
 * is written to the database until the owner confirms, and the import screen
 * needs the account id long before that, because every row's `import_hash`
 * includes it.
 *
 * Pure: no database, no React. The screens hold one of these in state and hand
 * every tap to the functions below.
 */

/** The little a choice needs to know about an account. */
export interface ChoosableAccount {
  readonly id: string;
  /** The bank it sits under, or null when it belongs to none. */
  readonly institutionId: string | null;
}

/** A tap on the bank row: an existing bank, "not in a bank", or a new one. */
export interface BankChoice {
  /** Null both for "not in a bank" and for a bank that does not exist yet. */
  readonly institutionId: string | null;
  readonly isNew: boolean;
}

export interface AccountChoice {
  /** The bank the account sits under. Null for "not in a bank" and for a new bank. */
  readonly institutionId: string | null;
  /** The bank is created on confirm, under `institutionName`. */
  readonly newInstitution: boolean;
  /** Name for a bank still to be created; empty until the owner types one. */
  readonly institutionName: string;
  /**
   * The account the rows are hashed for. Generated up front when `newAccount`,
   * so the account that is created on confirm is the one the hashes name.
   */
  readonly accountId: string;
  /** The account is created on confirm, under `accountName`. */
  readonly newAccount: boolean;
  readonly accountName: string;
}

/** The accounts the second row offers: the ones under the chosen bank. */
export function accountsInBank<T extends ChoosableAccount>(
  accounts: readonly T[],
  choice: Pick<AccountChoice, 'institutionId' | 'newInstitution'>,
): T[] {
  if (choice.newInstitution) return [];
  return accounts.filter((account) => account.institutionId === choice.institutionId);
}

/**
 * The choice a screen opens on: the first candidate account that still exists,
 * together with its bank.
 *
 * The caller states the precedence by ordering `candidateIds` — on the import
 * screen: the account a camt.053 statement names by IBAN, then the account the
 * last import went to, then "My records". Null and unknown ids are skipped, so
 * an account deleted since the last import does not preselect a ghost.
 *
 * An account pointing at a bank that is no longer in `institutionIds` is shown
 * under no bank, which is where the banks screen lists it too.
 */
export function resolveAccountChoice(options: {
  readonly accounts: readonly ChoosableAccount[];
  readonly institutionIds: readonly string[];
  readonly candidateIds: readonly (string | null | undefined)[];
  /** Seeds both name fields, for the bank or account the owner may then create. */
  readonly suggestedName: string;
}): AccountChoice | null {
  const known = new Set(options.institutionIds);
  for (const candidate of options.candidateIds) {
    if (!candidate) continue;
    const account = options.accounts.find((row) => row.id === candidate);
    if (!account) continue;
    const institutionId =
      account.institutionId !== null && known.has(account.institutionId)
        ? account.institutionId
        : null;
    return {
      institutionId,
      newInstitution: false,
      institutionName: options.suggestedName,
      accountId: account.id,
      newAccount: false,
      accountName: options.suggestedName,
    };
  }
  return null;
}

/**
 * Applies a tap on the bank row. The account choice follows the bank: its
 * first account, or a new account when it holds none — an account of another
 * bank must never stay selected under a bank it does not belong to.
 *
 * Tapping the bank already chosen changes nothing, so a new account keeps the
 * id its rows were hashed for. The names typed so far are kept either way:
 * they are drafts, and losing them on a mistaken tap would be rude.
 */
export function chooseBank(
  choice: AccountChoice,
  bank: BankChoice,
  accounts: readonly ChoosableAccount[],
  newAccountId: () => string,
): AccountChoice {
  if (choice.newInstitution === bank.isNew && choice.institutionId === bank.institutionId) {
    return choice;
  }
  const moved: AccountChoice = {
    ...choice,
    institutionId: bank.isNew ? null : bank.institutionId,
    newInstitution: bank.isNew,
  };
  const first = accountsInBank(accounts, moved)[0];
  return first
    ? { ...moved, accountId: first.id, newAccount: false }
    : { ...moved, accountId: newAccountId(), newAccount: true };
}

/** Applies a tap on an existing account. */
export function chooseAccount(choice: AccountChoice, accountId: string): AccountChoice {
  return { ...choice, accountId, newAccount: false };
}

/**
 * Applies a tap on "new account". The id is generated once and then left
 * alone: the preview's rows are hashed for it, and a second tap that moved it
 * would store rows under an account they were not hashed for.
 */
export function chooseNewAccount(choice: AccountChoice, newAccountId: () => string): AccountChoice {
  if (choice.newAccount) return choice;
  return { ...choice, accountId: newAccountId(), newAccount: true };
}

/** True while something the owner is creating still has no name to be created under. */
export function accountChoiceNeedsName(choice: AccountChoice): boolean {
  if (choice.newInstitution && choice.institutionName.trim() === '') return true;
  return choice.newAccount && choice.accountName.trim() === '';
}
