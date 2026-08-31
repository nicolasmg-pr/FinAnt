import { importHashOf, money } from '@finant/core';
import type { DraftTransaction } from '@finant/importers';
import { readGoCardlessCredentials } from '../security/keys';
import {
  BankProviderError,
  type BankProvider,
  type Institution,
  type LinkSession,
  type RemoteAccount,
} from './bank-provider';

const BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2';

interface TokenPair {
  access: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** In-memory only. The access token is never written to disk: it is cheap to
 * mint again and worth nothing to an attacker who cannot read the keychain. */
let token: TokenPair | null = null;

interface GoCardlessTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  endToEndId?: string;
  additionalInformation?: string;
}

async function request<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new BankProviderError((error as Error).message, 'network');
  }

  if (response.ok) return (await response.json()) as T;

  const body = await response.text();
  // GoCardless answers 429 when the per-account daily quota is spent. Most banks
  // allow four syncs a day; retrying immediately just burns the next one.
  if (response.status === 429) throw new BankProviderError(body, 'rate-limited', 429);
  if (response.status === 401) throw new BankProviderError(body, 'credentials-invalid', 401);
  if (response.status === 403) throw new BankProviderError(body, 'consent-expired', 403);
  throw new BankProviderError(body, 'unknown', response.status);
}

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 30_000) return token.access;

  const credentials = await readGoCardlessCredentials();
  if (!credentials) {
    throw new BankProviderError('No GoCardless credentials on this device', 'credentials-missing');
  }

  const result = await request<{ access: string; access_expires: number }>('/token/new/', {
    method: 'POST',
    body: JSON.stringify({
      secret_id: credentials.secretId,
      secret_key: credentials.secretKey,
    }),
  });

  token = { access: result.access, expiresAt: Date.now() + result.access_expires * 1000 };
  return token.access;
}

function textOf(tx: GoCardlessTransaction): string {
  const parts = tx.remittanceInformationUnstructuredArray?.length
    ? tx.remittanceInformationUnstructuredArray.join(' ')
    : tx.remittanceInformationUnstructured;
  return (parts ?? tx.additionalInformation ?? tx.creditorName ?? tx.debtorName ?? '(no description)').trim();
}

/**
 * Talks to GoCardless Bank Account Data directly from the device, using the
 * owner's own API credentials held in the keychain. Correct for a personal
 * install; see the note on `BankProvider` before shipping this to other people.
 */
export const goCardlessDeviceProvider: BankProvider = {
  id: 'gocardless-device',

  async isConfigured() {
    return (await readGoCardlessCredentials()) !== null;
  },

  async listInstitutions(countryCode: string): Promise<Institution[]> {
    const raw = await request<
      { id: string; name: string; bic?: string; logo?: string; countries: string[]; transaction_total_days?: string }[]
    >(`/institutions/?country=${encodeURIComponent(countryCode.toLowerCase())}`, {}, await accessToken());

    return raw
      .map((i) => ({
        id: i.id,
        name: i.name,
        bic: i.bic ?? null,
        logo: i.logo ?? null,
        countries: i.countries,
        transactionTotalDays: Number(i.transaction_total_days ?? 90),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async startLink({ institutionId, redirectUri, language, maxHistoricalDays = 730 }): Promise<LinkSession> {
    const access = await accessToken();

    // The agreement pins how much history the bank will hand over and how long
    // the consent lasts. Banks cap both; asking for more than the institution
    // allows is rejected outright, so callers pass the institution's own value.
    const agreement = await request<{ id: string }>(
      '/agreements/enduser/',
      {
        method: 'POST',
        body: JSON.stringify({
          institution_id: institutionId,
          max_historical_days: maxHistoricalDays,
          access_valid_for_days: 180,
          access_scope: ['balances', 'details', 'transactions'],
        }),
      },
      access,
    );

    const requisition = await request<{ id: string; link: string }>(
      '/requisitions/',
      {
        method: 'POST',
        body: JSON.stringify({
          redirect: redirectUri,
          institution_id: institutionId,
          agreement: agreement.id,
          user_language: language.toUpperCase(),
        }),
      },
      access,
    );

    return { requisitionId: requisition.id, consentUrl: requisition.link };
  },

  async listLinkedAccounts(requisitionId: string): Promise<RemoteAccount[]> {
    const access = await accessToken();
    const requisition = await request<{ accounts: string[] }>(
      `/requisitions/${requisitionId}/`,
      {},
      access,
    );

    const accounts: RemoteAccount[] = [];
    for (const id of requisition.accounts) {
      const details = await request<{
        account: { iban?: string; name?: string; ownerName?: string; currency?: string; product?: string };
      }>(`/accounts/${id}/details/`, {}, access);
      accounts.push({
        externalAccountId: id,
        iban: details.account.iban ?? null,
        name: details.account.name ?? details.account.product ?? details.account.iban ?? 'Account',
        currency: details.account.currency ?? 'EUR',
      });
    }
    return accounts;
  },

  async fetchTransactions({ externalAccountId, accountId, dateFrom }): Promise<DraftTransaction[]> {
    const access = await accessToken();
    const query = dateFrom ? `?date_from=${encodeURIComponent(dateFrom)}` : '';
    const payload = await request<{
      transactions: { booked: GoCardlessTransaction[]; pending?: GoCardlessTransaction[] };
    }>(`/accounts/${externalAccountId}/transactions/${query}`, {}, access);

    // Only booked movements are stored. Pending entries change amount and
    // description before they settle, and would import as duplicates.
    return payload.transactions.booked.flatMap((tx) => {
      const bookingDate = tx.bookingDate ?? tx.valueDate;
      if (!bookingDate) return [];

      const currency = tx.transactionAmount.currency;
      const decimal = tx.transactionAmount.amount;
      const minor = Math.round(Number(decimal) * 100);
      if (!Number.isFinite(minor)) return [];

      const description = textOf(tx);
      return [
        {
          accountId,
          bookingDate,
          valueDate: tx.valueDate ?? null,
          amount: money(minor, currency),
          description,
          counterparty: tx.creditorName ?? tx.debtorName ?? null,
          reference: tx.endToEndId ?? null,
          suggestedCategoryId: null,
          source: 'gocardless' as const,
          externalId: tx.transactionId ?? tx.internalTransactionId ?? null,
          importHash: importHashOf({ accountId, bookingDate, amountMinor: minor, description }),
          notes: null,
        },
      ];
    });
  },
};

/** Test seam: drops the cached access token. */
export function resetGoCardlessToken(): void {
  token = null;
}
