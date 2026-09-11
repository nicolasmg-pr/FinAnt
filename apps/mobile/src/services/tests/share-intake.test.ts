import { beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_SHARE_NAME,
  peekPendingShare,
  setPendingShare,
  shareNameFromUri,
  takePendingShare,
} from '../share-intake';

describe('takePendingShare', () => {
  beforeEach(() => {
    takePendingShare();
  });

  it('is empty until something arrives', () => {
    expect(takePendingShare()).toBeNull();
  });

  it('hands the file over exactly once', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(takePendingShare()).toEqual({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(takePendingShare()).toBeNull();
  });

  it('keeps the newest file when two arrive before either is read', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    setPendingShare({ uri: 'file:///cache/b.pdf', name: 'b.pdf' });
    expect(takePendingShare()?.name).toBe('b.pdf');
  });
});

describe('peekPendingShare', () => {
  beforeEach(() => {
    takePendingShare();
  });

  it('is empty until something arrives', () => {
    expect(peekPendingShare()).toBeNull();
  });

  it('returns the staged file without clearing it', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(peekPendingShare()).toEqual({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    // Still there: a second peek must see the same file as the first.
    expect(peekPendingShare()).toEqual({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
  });

  it('leaves the file for takePendingShare to read and clear afterwards', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    peekPendingShare();
    expect(takePendingShare()).toEqual({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(takePendingShare()).toBeNull();
  });
});

describe('shareNameFromUri', () => {
  it('percent-decodes the last segment', () => {
    // iOS hands over the file in the app's Inbox directory, named as the
    // sending app named it: Trade Republic's export is Spanish-titled.
    expect(shareNameFromUri('file:///var/mobile/Inbox/Certificado%20de%20saldo.pdf')).toBe(
      'Certificado de saldo.pdf',
    );
  });

  it('drops a query and a fragment', () => {
    expect(shareNameFromUri('file:///tmp/statement.csv?v=2')).toBe('statement.csv');
    expect(shareNameFromUri('file:///tmp/statement.csv#page=1')).toBe('statement.csv');
  });

  it('falls back when there is no usable segment', () => {
    expect(shareNameFromUri('file:///')).toBe(FALLBACK_SHARE_NAME);
    expect(shareNameFromUri('content://media/external/downloads')).toBe('downloads');
    // An undecodable name is still shown verbatim rather than swallowed.
    expect(shareNameFromUri('%%%not-a-uri')).toBe('%%%not-a-uri');
  });
});
