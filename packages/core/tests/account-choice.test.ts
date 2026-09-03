import { describe, expect, it } from 'vitest';
import {
  accountChoiceNeedsName,
  accountsInBank,
  chooseAccount,
  chooseBank,
  chooseNewAccount,
  resolveAccountChoice,
  type ChoosableAccount,
} from '../src/account-choice';

const accounts: ChoosableAccount[] = [
  { id: 'local', institutionId: null },
  { id: 'ing-current', institutionId: 'ing' },
  { id: 'ing-savings', institutionId: 'ing' },
  { id: 'dkb-current', institutionId: 'dkb' },
];
const institutionIds = ['dkb', 'ing'];

/** A counter, so a test can tell one generated account id from the next. */
function ids(): () => string {
  let next = 0;
  return () => `new-${++next}`;
}

describe('resolveAccountChoice', () => {
  it('takes the first candidate that names a known account', () => {
    const choice = resolveAccountChoice({
      accounts,
      institutionIds,
      candidateIds: [null, 'gone', 'ing-savings', 'local'],
      suggestedName: 'ING',
    });
    expect(choice).toEqual({
      institutionId: 'ing',
      newInstitution: false,
      institutionName: 'ING',
      accountId: 'ing-savings',
      newAccount: false,
      accountName: 'ING',
    });
  });

  it('selects the bank of the account it picked', () => {
    const choice = resolveAccountChoice({
      accounts,
      institutionIds,
      candidateIds: ['dkb-current'],
      suggestedName: '',
    });
    expect(choice?.institutionId).toBe('dkb');
  });

  it('leaves an account of no bank under no bank', () => {
    const choice = resolveAccountChoice({
      accounts,
      institutionIds,
      candidateIds: ['local'],
      suggestedName: '',
    });
    expect(choice?.institutionId).toBeNull();
    expect(choice?.newInstitution).toBe(false);
  });

  it('treats a bank that no longer exists as no bank', () => {
    const choice = resolveAccountChoice({
      accounts: [{ id: 'orphan', institutionId: 'deleted' }],
      institutionIds,
      candidateIds: ['orphan'],
      suggestedName: '',
    });
    expect(choice?.institutionId).toBeNull();
  });

  it('returns null when no candidate exists', () => {
    expect(
      resolveAccountChoice({
        accounts,
        institutionIds,
        candidateIds: [undefined, 'gone'],
        suggestedName: '',
      }),
    ).toBeNull();
  });
});

describe('accountsInBank', () => {
  it('lists only the accounts of the chosen bank', () => {
    expect(
      accountsInBank(accounts, { institutionId: 'ing', newInstitution: false }).map((a) => a.id),
    ).toEqual(['ing-current', 'ing-savings']);
  });

  it('lists the accounts of no bank when no bank is chosen', () => {
    expect(
      accountsInBank(accounts, { institutionId: null, newInstitution: false }).map((a) => a.id),
    ).toEqual(['local']);
  });

  it('lists nothing for a bank that does not exist yet', () => {
    expect(accountsInBank(accounts, { institutionId: null, newInstitution: true })).toEqual([]);
  });
});

describe('chooseBank', () => {
  const base = resolveAccountChoice({
    accounts,
    institutionIds,
    candidateIds: ['local'],
    suggestedName: 'Openbank',
  });

  it('moves to the first account of the bank that was chosen', () => {
    const choice = chooseBank(base!, { institutionId: 'ing', isNew: false }, accounts, ids());
    expect(choice.institutionId).toBe('ing');
    expect(choice.accountId).toBe('ing-current');
    expect(choice.newAccount).toBe(false);
  });

  it('offers a new account when the bank has none', () => {
    const empty = [{ id: 'local', institutionId: null }];
    const choice = chooseBank(base!, { institutionId: 'ing', isNew: false }, empty, ids());
    expect(choice.accountId).toBe('new-1');
    expect(choice.newAccount).toBe(true);
  });

  it('needs a new account for a bank that does not exist yet', () => {
    const choice = chooseBank(base!, { institutionId: null, isNew: true }, accounts, ids());
    expect(choice).toMatchObject({
      institutionId: null,
      newInstitution: true,
      accountId: 'new-1',
      newAccount: true,
    });
  });

  it('keeps the names typed so far while the bank changes', () => {
    const typed = { ...base!, institutionName: 'Openbank', accountName: 'Nómina' };
    const choice = chooseBank(typed, { institutionId: null, isNew: true }, accounts, ids());
    expect(choice.institutionName).toBe('Openbank');
    expect(choice.accountName).toBe('Nómina');
  });

  it('leaves the choice alone when the bank already chosen is tapped again', () => {
    const chosen = chooseBank(base!, { institutionId: 'ing', isNew: false }, accounts, ids());
    const again = chooseAccount(chosen, 'ing-savings');
    expect(chooseBank(again, { institutionId: 'ing', isNew: false }, accounts, ids())).toBe(again);
  });

  it('keeps the id of a new bank being named, so its account id does not move', () => {
    const fresh = chooseBank(base!, { institutionId: null, isNew: true }, accounts, ids());
    expect(chooseBank(fresh, { institutionId: null, isNew: true }, accounts, ids())).toBe(fresh);
  });
});

describe('chooseAccount', () => {
  const base = resolveAccountChoice({
    accounts,
    institutionIds,
    candidateIds: ['ing-current'],
    suggestedName: '',
  })!;

  it('takes an existing account', () => {
    const choice = chooseAccount(chooseNewAccount(base, ids()), 'ing-savings');
    expect(choice).toMatchObject({ accountId: 'ing-savings', newAccount: false });
  });

  it('generates one id for a new account and keeps it', () => {
    const factory = ids();
    const first = chooseNewAccount(base, factory);
    expect(first).toMatchObject({ accountId: 'new-1', newAccount: true });
    // The rows are hashed for this id: a second tap must not move it.
    expect(chooseNewAccount(first, factory)).toBe(first);
  });
});

describe('accountChoiceNeedsName', () => {
  const base = resolveAccountChoice({
    accounts,
    institutionIds,
    candidateIds: ['local'],
    suggestedName: '',
  })!;

  it('is false when nothing is being created', () => {
    expect(accountChoiceNeedsName(base)).toBe(false);
  });

  it('is true while a new account has no name', () => {
    expect(accountChoiceNeedsName(chooseNewAccount(base, ids()))).toBe(true);
  });

  it('is true while a new bank has only blank space for a name', () => {
    const fresh = chooseBank(base, { institutionId: null, isNew: true }, accounts, ids());
    expect(accountChoiceNeedsName({ ...fresh, accountName: 'Nómina', institutionName: '  ' })).toBe(
      true,
    );
  });

  it('is false once both names are filled in', () => {
    const fresh = chooseBank(base, { institutionId: null, isNew: true }, accounts, ids());
    expect(
      accountChoiceNeedsName({ ...fresh, institutionName: 'Openbank', accountName: 'Nómina' }),
    ).toBe(false);
  });
});
