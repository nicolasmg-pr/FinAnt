import { describe, expect, it } from 'vitest';
import {
  attachBackupSql,
  BACKUP_TABLES,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  formatRecoveryCode,
  isValidRecoveryCode,
  mergeTableSql,
  normaliseRecoveryCode,
  openBackupSql,
} from '../src/backup';

const BYTES = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

describe('formatRecoveryCode', () => {
  it('produces five groups of five', () => {
    const code = formatRecoveryCode(BYTES);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  });

  it('is deterministic for the same bytes', () => {
    expect(formatRecoveryCode(BYTES)).toBe(formatRecoveryCode(BYTES));
  });

  it('differs when the bytes differ', () => {
    const other = Uint8Array.from(BYTES);
    other[0] = 0x01;
    expect(formatRecoveryCode(other)).not.toBe(formatRecoveryCode(BYTES));
  });

  // I, L, O and U are absent from Crockford base32 so a handwritten code
  // cannot be transcribed into a different one.
  it('never emits an ambiguous letter', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const bytes = Uint8Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 7) % 256);
      expect(formatRecoveryCode(bytes)).not.toMatch(/[ILOU]/);
    }
  });

  it('refuses fewer than sixteen bytes', () => {
    expect(() => formatRecoveryCode(Uint8Array.from([1, 2, 3]))).toThrow();
  });

  // This value is frozen by every backup file created with this encoder.
  // A change to the bit-packing algorithm would silently render every existing
  // backup unrecoverable. Do not alter this assertion casually.
  it('produces the known-answer value for the fixture', () => {
    expect(formatRecoveryCode(BYTES)).toBe('008J4-CT4AN-K7F24-SNAXW-SQFEZ');
  });
});

describe('normaliseRecoveryCode', () => {
  const code = formatRecoveryCode(BYTES);

  it('accepts the code it produced', () => {
    expect(normaliseRecoveryCode(code)).toBe(code);
  });

  it('accepts lowercase', () => {
    expect(normaliseRecoveryCode(code.toLowerCase())).toBe(code);
  });

  it('accepts an ungrouped paste with stray whitespace', () => {
    const ungrouped = ` ${code.replace(/-/g, '')} `;
    expect(normaliseRecoveryCode(ungrouped)).toBe(code);
  });

  // Crockford's own decoding rule. The alphabet has no I, L or O, so mapping
  // them is unambiguous and saves a transcription from being rejected.
  it('maps the letters the alphabet omits onto their digits', () => {
    expect(normaliseRecoveryCode('IL0OO-00000-00000-00000-00000')).toBe(
      '11000-00000-00000-00000-00000',
    );
  });
});

describe('isValidRecoveryCode', () => {
  it('accepts a generated code in any casing or grouping', () => {
    const code = formatRecoveryCode(BYTES);
    expect(isValidRecoveryCode(code)).toBe(true);
    expect(isValidRecoveryCode(code.toLowerCase())).toBe(true);
    expect(isValidRecoveryCode(code.replace(/-/g, ''))).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND')).toBe(false);
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND-8YCJV-X')).toBe(false);
  });

  it('rejects U, which the alphabet deliberately omits and does not remap', () => {
    expect(isValidRecoveryCode('UUUUU-UUUUU-UUUUU-UUUUU-UUUUU')).toBe(false);
  });

  // The code is interpolated into a PRAGMA, which cannot be parameterised.
  // These must never survive validation.
  it('rejects anything that could end a SQL string', () => {
    expect(isValidRecoveryCode("K7F2M-9XQ4B-3HTZW-5PRND-8YC'V")).toBe(false);
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND-8YC;V')).toBe(false);
    expect(isValidRecoveryCode("'; DROP TABLE transactions; --")).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidRecoveryCode('')).toBe(false);
  });
});

describe('BACKUP_TABLES', () => {
  // INSERT OR IGNORE runs with foreign keys on, so a child inserted before its
  // parent fails the whole restore.
  const PARENTS: Readonly<Record<string, readonly string[]>> = {
    accounts: ['institutions'],
    transactions: ['accounts', 'categories'],
    investment_legs: ['transactions', 'assets'],
    quotes: ['assets'],
    price_history: ['assets'],
    notification_routes: ['notification_sources', 'accounts'],
    rules: ['categories'],
    budgets: ['categories'],
  };

  it('lists every parent before its children', () => {
    for (const [child, parents] of Object.entries(PARENTS)) {
      const childIndex = BACKUP_TABLES.indexOf(child);
      expect(childIndex, `${child} is missing from the manifest`).toBeGreaterThanOrEqual(0);
      for (const parent of parents) {
        expect(
          BACKUP_TABLES.indexOf(parent),
          `${parent} must precede ${child}`,
        ).toBeGreaterThanOrEqual(0);
        expect(BACKUP_TABLES.indexOf(parent)).toBeLessThan(childIndex);
      }
    }
  });

  it('holds no duplicates', () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });

  it('shares nothing with the exclusion list', () => {
    for (const table of EXCLUDED_TABLES) {
      expect(BACKUP_TABLES).not.toContain(table);
    }
  });

  // Raw notification text is the most sensitive free text in the database and
  // the inbox is transient; anything accepted from it is already a transaction.
  it('excludes the notification inbox', () => {
    expect(EXCLUDED_TABLES).toContain('notification_captures');
  });
});

describe('SQL builders', () => {
  const CODE = 'K7F2M-9XQ4B-3HTZW-5PRND-8YCJV';

  it('attaches with the code as a passphrase', () => {
    expect(attachBackupSql('/tmp/b.finantbackup', CODE)).toBe(
      `ATTACH DATABASE '/tmp/b.finantbackup' AS backup KEY '${CODE}';`,
    );
  });

  it('normalises the code before interpolating it', () => {
    expect(attachBackupSql('/tmp/b.finantbackup', CODE.toLowerCase())).toContain(CODE);
  });

  it('refuses a code that failed validation', () => {
    expect(() =>
      attachBackupSql('/tmp/b.finantbackup', "x'; DROP TABLE transactions; --"),
    ).toThrow();
  });

  it('escapes a quote in the path rather than trusting it', () => {
    expect(attachBackupSql("/tmp/o'brien.finantbackup", CODE)).toContain(
      "'/tmp/o''brien.finantbackup'",
    );
  });

  it('exports into the attached schema', () => {
    expect(exportBackupSql()).toBe("SELECT sqlcipher_export('backup');");
  });

  it('merges a manifest table insert-only', () => {
    expect(mergeTableSql('transactions')).toBe(
      'INSERT OR IGNORE INTO main.transactions SELECT * FROM backup.transactions;',
    );
  });

  // The table name is interpolated, so it comes from the manifest or not at all.
  it('refuses a table outside the manifest', () => {
    expect(() => mergeTableSql('notification_captures')).toThrow();
    expect(() => mergeTableSql('sqlite_master; DROP TABLE accounts; --')).toThrow();
  });

  it('detaches', () => {
    expect(detachBackupSql()).toBe('DETACH DATABASE backup;');
  });

  it('opens a backup file with the code as a passphrase', () => {
    expect(openBackupSql(CODE)).toBe(`PRAGMA key = '${CODE}';`);
  });

  it('refuses to open with a malformed code', () => {
    expect(() => openBackupSql("'; DROP TABLE accounts; --")).toThrow();
  });
});
