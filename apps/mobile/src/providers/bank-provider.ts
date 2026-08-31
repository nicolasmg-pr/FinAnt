import type { DraftTransaction } from '@finant/importers';

export interface Institution {
  readonly id: string;
  readonly name: string;
  readonly bic: string | null;
  readonly logo: string | null;
  readonly countries: readonly string[];
  readonly transactionTotalDays: number;
}

export interface LinkSession {
  /** Requisition id, stored on the account so a sync can find its accounts later. */
  readonly requisitionId: string;
  /** URL to open in the browser for the bank's own consent flow. */
  readonly consentUrl: string;
}

export interface RemoteAccount {
  readonly externalAccountId: string;
  readonly iban: string | null;
  readonly name: string;
  readonly currency: string;
}

/**
 * Everything the app needs from a bank-data source.
 *
 * The interface exists so the credential handling can change without the UI or
 * the storage layer noticing. Today `GoCardlessDeviceProvider` talks to
 * GoCardless directly using the owner's own credentials from the device
 * keychain, which is correct for a personal install. Distributing the app to
 * other people requires a second implementation that calls a stateless broker
 * holding the credentials server-side — a shared secret_key inside a published
 * binary would expose every user's bank connection, not just the extractor's.
 */
export interface BankProvider {
  readonly id: string;
  isConfigured(): Promise<boolean>;
  listInstitutions(countryCode: string): Promise<Institution[]>;
  startLink(input: {
    institutionId: string;
    redirectUri: string;
    language: string;
    maxHistoricalDays?: number;
  }): Promise<LinkSession>;
  listLinkedAccounts(requisitionId: string): Promise<RemoteAccount[]>;
  fetchTransactions(input: {
    externalAccountId: string;
    accountId: string;
    /** Provider-side lower bound; omit for the full window the consent allows. */
    dateFrom?: string;
  }): Promise<DraftTransaction[]>;
}

export class BankProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'credentials-missing'
      | 'credentials-invalid'
      | 'consent-expired'
      | 'rate-limited'
      | 'network'
      | 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BankProviderError';
  }
}
