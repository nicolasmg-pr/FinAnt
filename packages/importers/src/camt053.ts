import { XMLParser } from 'fast-xml-parser';
import { importHashOf, money, type CurrencyCode } from '@finant/core';
import type { DraftTransaction, ImportIssue, ImportResult } from './profile';
import { parseAmount } from './values';

/**
 * ISO 20022 camt.053 bank statement reader.
 *
 * Every SEPA bank can produce camt.053, so this covers institutions GoCardless
 * does not reach and gives a vendor-neutral archive format. Only the fields
 * FinAnt needs are read; the rest of the schema is ignored on purpose.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)['#text'] ?? '');
  }
  return '';
}

function date(node: unknown): string | null {
  const raw = text((node as Record<string, unknown>)?.['Dt'] ?? node);
  const dateTime = text((node as Record<string, unknown>)?.['DtTm']);
  const value = raw || dateTime;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function parseCamt053(xml: string, context: { accountId: string }): ImportResult {
  const transactions: DraftTransaction[] = [];
  const issues: ImportIssue[] = [];

  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml) as Record<string, any>;
  } catch (error) {
    return {
      profileId: 'camt053',
      transactions: [],
      issues: [{ row: 0, message: `Not valid XML: ${(error as Error).message}`, raw: [] }],
    };
  }

  const statements = asArray(doc?.['Document']?.['BkToCstmrStmt']?.['Stmt']);
  if (statements.length === 0) {
    return {
      profileId: 'camt053',
      transactions: [],
      issues: [{ row: 0, message: 'No camt.053 statement found in this file', raw: [] }],
    };
  }

  let index = 0;
  for (const statement of statements) {
    for (const entry of asArray(statement?.['Ntry'])) {
      index += 1;
      const amountNode = entry?.['Amt'];
      const currency = (amountNode?.['@Ccy'] as CurrencyCode | undefined) ?? 'EUR';
      const magnitude = parseAmount(text(amountNode), currency, '.');
      const bookingDate = date(entry?.['BkgDt'] ?? entry?.['BookgDt']);
      const indicator = text(entry?.['CdtDbtInd']);

      if (!magnitude || !bookingDate) {
        issues.push({ row: index, message: 'Entry missing amount or booking date', raw: [] });
        continue;
      }

      // camt.053 amounts are unsigned; direction lives in CdtDbtInd.
      const signed = money(
        indicator === 'DBIT' ? -Math.abs(magnitude.minor) : Math.abs(magnitude.minor),
        currency,
      );

      const details = asArray(entry?.['NtryDtls'])[0]?.['TxDtls'];
      const tx = asArray(details)[0];
      const parties = tx?.['RltdPties'];
      const counterparty =
        text(parties?.['Cdtr']?.['Nm']) || text(parties?.['Dbtr']?.['Nm']) || null;
      const remittance = asArray(tx?.['RmtInf']?.['Ustrd']).map(text).join(' ').trim();
      const description = remittance || text(entry?.['AddtlNtryInf']) || counterparty || '(no description)';
      const externalId =
        text(tx?.['Refs']?.['EndToEndId']) ||
        text(entry?.['AcctSvcrRef']) ||
        null;

      transactions.push({
        accountId: context.accountId,
        bookingDate,
        valueDate: date(entry?.['ValDt']),
        amount: signed,
        description,
        counterparty,
        reference: text(tx?.['Refs']?.['MndtId']) || null,
        suggestedCategoryId: null,
        source: 'file-import',
        externalId: externalId && externalId !== 'NOTPROVIDED' ? externalId : null,
        importHash: importHashOf({
          accountId: context.accountId,
          bookingDate,
          amountMinor: signed.minor,
          description,
        }),
        notes: null,
      });
    }
  }

  return { profileId: 'camt053', transactions, issues };
}
