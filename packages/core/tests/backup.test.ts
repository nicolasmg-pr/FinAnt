import { describe, expect, it } from 'vitest';
import {
  attachBackupSql,
  BACKUP_TABLES,
  deleteRetiredShippedRulesSql,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  formatRecoveryCode,
  isValidRecoveryCode,
  mergeRetiredShippedRuleIds,
  mergeTableSql,
  normaliseRecoveryCode,
  openBackupSql,
  pristineShippedRuleIds,
  reseedPristineCategoriesSql,
  reseedPristineRulesSql,
  serialiseRetiredShippedRules,
  type StoredRuleRow,
} from '../src/backup';
import { parseRetiredShippedRules } from '../src/default-rules';
import type { CategoryRule } from '../src/types';

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
  // Deferred foreign keys mean a child could in fact arrive before its parent
  // and still commit; keeping the order right is what stops the merge relying
  // on that deferral being in force.
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

describe('pristineShippedRuleIds', () => {
  const shipped: CategoryRule[] = [
    {
      id: 'r-salary',
      categoryId: 'income-salary',
      priority: 400,
      enabled: true,
      learned: false,
      match: { kind: 'word', field: 'any', value: 'nomina' },
    },
    {
      id: 'r-groceries',
      categoryId: 'food-groceries',
      priority: 200,
      enabled: true,
      learned: false,
      match: { kind: 'word', field: 'any', value: 'mercadona' },
    },
  ];

  const seeded = (rule: CategoryRule): StoredRuleRow => ({
    id: rule.id,
    categoryId: rule.categoryId,
    priority: rule.priority,
    enabled: rule.enabled,
    learned: rule.learned,
    matchJson: JSON.stringify(rule.match),
  });

  it('names a row still exactly as the app seeded it', () => {
    expect(pristineShippedRuleIds(shipped, shipped.map(seeded))).toEqual([
      'r-salary',
      'r-groceries',
    ]);
  });

  it('leaves a rule the owner disabled to the device', () => {
    const live = shipped.map(seeded);
    const row = live[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(pristineShippedRuleIds(shipped, [{ ...row, enabled: false }, ...live.slice(1)])).toEqual(
      ['r-groceries'],
    );
  });

  it('leaves a rule the owner re-pointed at another category to the device', () => {
    const live = shipped.map(seeded);
    const row = live[1];
    expect(row).toBeDefined();
    if (!row) return;
    expect(
      pristineShippedRuleIds(shipped, [...live.slice(0, 1), { ...row, categoryId: 'food-other' }]),
    ).toEqual(['r-salary']);
  });

  it('leaves a rule whose priority or match text was edited to the device', () => {
    const [salary, groceries] = shipped.map(seeded);
    expect(salary).toBeDefined();
    expect(groceries).toBeDefined();
    if (!salary || !groceries) return;
    expect(
      pristineShippedRuleIds(shipped, [
        { ...salary, priority: 900 },
        { ...groceries, matchJson: '{"kind":"word","field":"any","value":"lidl"}' },
      ]),
    ).toEqual([]);
  });

  // A learned rule carries the owner's own re-categorisation, whatever id it
  // happens to hold.
  it('leaves a row marked learned to the device', () => {
    const live = shipped.map(seeded);
    const row = live[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(pristineShippedRuleIds(shipped, [{ ...row, learned: true }])).toEqual([]);
  });

  it('says nothing about a rule the database does not have', () => {
    expect(pristineShippedRuleIds(shipped, [])).toEqual([]);
  });

  it('ignores a rule the owner created', () => {
    const live = shipped.map(seeded);
    const row = live[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(pristineShippedRuleIds(shipped, [...live, { ...row, id: 'user-1234' }])).toEqual([
      'r-salary',
      'r-groceries',
    ]);
  });
});

describe('reseedPristineCategoriesSql', () => {
  // The live schema's own column order, as PRAGMA table_info reports it.
  const COLUMNS = [
    'id',
    'label_key',
    'name',
    'kind',
    'parent_id',
    'color',
    'icon',
    'built_in',
    'archived',
    'position',
    'customised',
  ];

  const sql = reseedPristineCategoriesSql(COLUMNS);

  // The seeded row loses: a fresh install writes the shipped taxonomy before
  // any restore can run, so INSERT OR IGNORE alone would revert every rename
  // and recolour the owner ever made.
  it('takes every column but the id from the backup', () => {
    expect(sql).toContain(
      '(label_key, name, kind, parent_id, color, icon, built_in, archived, position, customised) = ',
    );
    expect(sql).toContain('SELECT b.label_key, b.name,');
    // The id is the join key, never a value the backup writes over.
    expect(sql).not.toContain('SET (id,');
    expect(sql).not.toContain('SELECT b.id,');
  });

  // The owner-edited row wins: `customised` is the flag editCategory() sets and
  // syncBuiltInCategories() already reads for this exact question.
  it('refuses to touch a row the owner edited or created', () => {
    expect(sql).toContain('c.built_in = 1');
    expect(sql).toContain('c.customised = 0');
  });

  // Archiving is the one edit that leaves `customised` at 0, so it has to be
  // named separately — and naming it is also what lets an archived category in
  // the backup come back archived on a phone that reseeded it visible.
  it('treats an archived live row as the owner’s work', () => {
    expect(sql).toContain('c.archived = 0');
  });

  it('only touches rows the backup actually has', () => {
    expect(sql).toContain('EXISTS (SELECT 1 FROM backup.categories AS b WHERE b.id = c.id)');
  });

  it('refuses a column name it does not recognise as one', () => {
    expect(() => reseedPristineCategoriesSql(['id', 'name; DROP TABLE accounts; --'])).toThrow();
  });

  it('refuses a column list with no id to join on', () => {
    expect(() => reseedPristineCategoriesSql(['name', 'color'])).toThrow();
  });

  it('refuses a column list with nothing to write', () => {
    expect(() => reseedPristineCategoriesSql(['id'])).toThrow();
  });
});

describe('reseedPristineRulesSql', () => {
  const COLUMNS = [
    'id',
    'category_id',
    'priority',
    'enabled',
    'learned',
    'match_json',
    'created_at',
  ];

  it('names only the rules it was given', () => {
    const sql = reseedPristineRulesSql(COLUMNS, ['r-salary', 'r-internal']);
    expect(sql).toContain("c.id IN ('r-salary', 'r-internal')");
    expect(sql).toContain('UPDATE main.rules AS c SET');
  });

  it('refuses an id this release does not ship', () => {
    expect(() => reseedPristineRulesSql(COLUMNS, ['user-1234'])).toThrow();
  });

  it('refuses to build a statement that would match every rule', () => {
    expect(() => reseedPristineRulesSql(COLUMNS, [])).toThrow();
  });
});

describe('deleteRetiredShippedRulesSql', () => {
  it('deletes exactly the tombstoned ids', () => {
    expect(deleteRetiredShippedRulesSql(['r-salary'])).toBe(
      "DELETE FROM main.rules WHERE id IN ('r-salary');",
    );
  });

  it('refuses an id this release does not ship', () => {
    expect(() => deleteRetiredShippedRulesSql(['user-1234'])).toThrow();
  });

  it('refuses an empty list rather than deleting every rule', () => {
    expect(() => deleteRetiredShippedRulesSql([])).toThrow();
  });
});

describe('mergeRetiredShippedRuleIds', () => {
  it('keeps an id only the device has tombstoned', () => {
    expect(mergeRetiredShippedRuleIds(JSON.stringify(['r-salary']), null)).toEqual(['r-salary']);
  });

  it('keeps an id only the backup has tombstoned', () => {
    expect(mergeRetiredShippedRuleIds(null, JSON.stringify(['r-salary']))).toEqual(['r-salary']);
  });

  // The disaster Finding 2 describes: a fresh phone tombstones one rule, then
  // restores a backup naming three different ones. INSERT OR IGNORE would
  // keep only the device's one id; the union must keep all four.
  it('unions ids that differ on both sides, device ids first', () => {
    expect(
      mergeRetiredShippedRuleIds(
        JSON.stringify(['r-cash']),
        JSON.stringify(['r-salary', 'r-fees', 'r-taxes']),
      ),
    ).toEqual(['r-cash', 'r-salary', 'r-fees', 'r-taxes']);
  });

  it('does not duplicate an id both sides tombstoned', () => {
    expect(
      mergeRetiredShippedRuleIds(
        JSON.stringify(['r-salary', 'r-cash']),
        JSON.stringify(['r-cash', 'r-salary']),
      ),
    ).toEqual(['r-salary', 'r-cash']);
  });

  it('is empty when neither side has tombstoned anything', () => {
    expect(mergeRetiredShippedRuleIds(null, null)).toEqual([]);
  });

  // parseRetiredShippedRules treats a corrupt setting as no tombstones, never
  // as a reason to fail the restore — the merge must be exactly as tolerant.
  it('treats malformed input on either side as no tombstones there', () => {
    expect(mergeRetiredShippedRuleIds('not json', JSON.stringify(['r-salary']))).toEqual([
      'r-salary',
    ]);
    expect(mergeRetiredShippedRuleIds(JSON.stringify(['r-salary']), '{"not":"an array"}')).toEqual([
      'r-salary',
    ]);
  });

  it('is idempotent: merging the result with either input again changes nothing', () => {
    const merged = mergeRetiredShippedRuleIds(
      JSON.stringify(['r-cash']),
      JSON.stringify(['r-salary', 'r-fees']),
    );
    const serialised = serialiseRetiredShippedRules(merged);
    expect(mergeRetiredShippedRuleIds(serialised, JSON.stringify(['r-salary', 'r-fees']))).toEqual(
      merged,
    );
    expect(mergeRetiredShippedRuleIds(serialised, null)).toEqual(merged);
  });
});

describe('serialiseRetiredShippedRules', () => {
  it('round-trips through parseRetiredShippedRules exactly', () => {
    const ids = ['r-salary', 'r-cash', 'r-fees'];
    expect(parseRetiredShippedRules(serialiseRetiredShippedRules(ids))).toEqual(ids);
  });

  it('round-trips an empty list', () => {
    expect(parseRetiredShippedRules(serialiseRetiredShippedRules([]))).toEqual([]);
  });

  it('writes a plain JSON array of strings, the shape deleteRule() writes', () => {
    expect(serialiseRetiredShippedRules(['r-salary'])).toBe('["r-salary"]');
  });
});
