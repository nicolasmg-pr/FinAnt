/**
 * How well the local assistant actually understands a question.
 *
 * The unit tests prove that a patch is resolved correctly. They cannot prove
 * that a 1.7B model produces the right patch in the first place, and nothing in
 * CI can: that needs the 1.3 GB model itself. So this runs on the owner's
 * machine, against a real GGUF, through llama.cpp — the same weights,
 * the same system prompt from `@finant/assistant`, and the same JSON schema
 * that becomes the sampling grammar on the phone.
 *
 * It is an eval, not a gate. It prints a score and the cases that missed.
 *
 *   npm run eval:assistant -- <model.gguf>
 *
 * Requires llama.cpp on PATH (`brew install llama.cpp`). It drives
 * `llama-server` rather than `llama-cli`: the CLI writes its generation to the
 * terminal rather than to a pipe, and the server loads the weights once for the
 * whole run instead of once per case.
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { EMPTY_FILTER, type ISODate, type TransactionFilter } from '@finant/core';
import {
  INITIAL_STATE,
  applyPatch,
  buildOutputSchema,
  buildPrompt,
  parsePatch,
  type AskContext,
  type AskState,
  type PromptAccount,
  type PromptCategory,
} from '@finant/assistant';

const TODAY = '2026-09-08' as ISODate;

/** Labels as each locale would show them, because that is what the model sees. */
const CATEGORIES: Record<string, readonly PromptCategory[]> = {
  'en-IE': [
    { id: 'groceries', name: 'Groceries' },
    { id: 'rent', name: 'Rent' },
    { id: 'transport', name: 'Transport' },
    { id: 'income-salary', name: 'Salary' },
  ],
  'es-ES': [
    { id: 'groceries', name: 'Supermercado' },
    { id: 'rent', name: 'Alquiler' },
    { id: 'transport', name: 'Transporte' },
    { id: 'income-salary', name: 'Nómina' },
  ],
  'de-DE': [
    { id: 'groceries', name: 'Lebensmittel' },
    { id: 'rent', name: 'Miete' },
    { id: 'transport', name: 'Verkehr' },
    { id: 'income-salary', name: 'Gehalt' },
  ],
};

const ACCOUNTS: readonly PromptAccount[] = [
  { id: 'acc-current', name: 'ING Girokonto' },
  { id: 'acc-savings', name: 'Trade Republic' },
];

interface Case {
  readonly name: string;
  readonly locale: keyof typeof CATEGORIES;
  readonly message: string;
  /** Where the conversation already was, for follow-up turns. */
  readonly previous?: AskState;
  /** Only the dimensions this question actually pins down are asserted. */
  readonly expect: Partial<TransactionFilter> & { readonly aggregate?: AskState['aggregate'] };
}

const CASES: readonly Case[] = [
  {
    name: 'en / category + relative range + sum',
    locale: 'en-IE',
    message: 'how much did I spend on groceries in the last three months?',
    expect: {
      categoryIds: ['groceries'],
      from: '2026-07-01',
      to: '2026-09-31',
      aggregate: 'sum',
    },
  },
  {
    name: 'en / named month + amount bound',
    locale: 'en-IE',
    message: 'show me anything over 100 euros in July',
    expect: { from: '2026-07-01', minMinor: 10000 },
  },
  {
    name: 'en / count',
    locale: 'en-IE',
    message: 'how many movements were there this year?',
    expect: { from: '2026-01-01', to: '2026-12-31', aggregate: 'count' },
  },
  {
    name: 'en / follow-up keeps the category',
    locale: 'en-IE',
    message: 'and in July?',
    previous: {
      filter: { ...EMPTY_FILTER, categoryIds: ['groceries'], from: '2026-07-01', to: '2026-09-31' },
      aggregate: 'sum',
    },
    expect: { categoryIds: ['groceries'], from: '2026-07-01' },
  },
  {
    name: 'es / category + relative range',
    locale: 'es-ES',
    message: '¿cuánto gasté en supermercado los últimos tres meses?',
    expect: { categoryIds: ['groceries'], from: '2026-07-01', aggregate: 'sum' },
  },
  {
    name: 'es / income side',
    locale: 'es-ES',
    message: 'enséñame los ingresos de este mes',
    expect: { side: 'income', from: '2026-09-01' },
  },
  {
    name: 'de / category + last month',
    locale: 'de-DE',
    message: 'wie viel habe ich letzten Monat für Miete bezahlt?',
    expect: { categoryIds: ['rent'], from: '2026-08-01', to: '2026-08-31' },
  },
  {
    name: 'de / amount bound only',
    locale: 'de-DE',
    message: 'alles über 50 Euro',
    expect: { minMinor: 5000 },
  },
  {
    name: 'en / free text for something with no category',
    locale: 'en-IE',
    message: 'find the payments to Lidl',
    expect: { text: 'Lidl' },
  },
];

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

async function startServer(modelPath: string) {
  const server = spawn(
    'llama-server',
    [
      '-m',
      modelPath,
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1',
      '--jinja',
      '-ngl',
      '99',
      '-c',
      '4096',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await delay(1000);
    try {
      const health = await fetch(`${BASE}/health`);
      if (health.ok) return server;
    } catch {
      // Still loading the weights.
    }
  }
  server.kill();
  throw new Error('llama-server did not come up');
}

interface ChatResponse {
  readonly choices: readonly { readonly message: { readonly content: string } }[];
}

async function runModel(system: string, user: string, schema: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // The same grammar route the phone takes, and the same reason thinking is
      // off: the whole output is at most nine short keys.
      response_format: { type: 'json_schema', json_schema: { schema: JSON.parse(schema) } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 256,
      seed: 1,
    }),
  });

  if (!response.ok) throw new Error(`llama-server returned ${response.status}`);
  const body = (await response.json()) as ChatResponse;
  return body.choices[0]?.message.content ?? '';
}

async function main(): Promise<void> {
  const modelPath = process.argv[2];
  if (modelPath === undefined) {
    console.error('usage: npm run eval:assistant -- <model.gguf>');
    process.exit(2);
  }

  console.log('Loading the model…');
  const server = await startServer(modelPath);
  let passed = 0;
  const failures: string[] = [];

  for (const testCase of CASES) {
    const categories = CATEGORIES[testCase.locale] ?? [];
    const previous = testCase.previous ?? INITIAL_STATE;
    const ctx: AskContext = {
      today: TODAY,
      currency: 'EUR',
      categoryIds: categories.map((category) => category.id),
      accountIds: ACCOUNTS.map((account) => account.id),
    };

    const { system, user } = buildPrompt({
      today: TODAY,
      locale: testCase.locale,
      categories,
      accounts: ACCOUNTS,
      state: previous,
      message: testCase.message,
    });

    const schema = JSON.stringify(
      buildOutputSchema({ categoryIds: ctx.categoryIds, accountIds: ctx.accountIds }),
    );

    let raw: string;
    try {
      raw = await runModel(system, user, schema);
    } catch (error) {
      failures.push(`${testCase.name}\n    llama-server failed: ${(error as Error).message}`);
      continue;
    }

    const { patch } = parsePatch(raw);
    const { state } = applyPatch(previous, patch, ctx);

    const wrong: string[] = [];
    for (const [key, want] of Object.entries(testCase.expect)) {
      const got =
        key === 'aggregate'
          ? state.aggregate
          : (state.filter as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`      ${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }

    if (wrong.length === 0) {
      passed += 1;
      console.log(`  pass  ${testCase.name}`);
    } else {
      console.log(`  FAIL  ${testCase.name}`);
      failures.push(
        `${testCase.name}\n${wrong.join('\n')}\n      raw: ${raw.trim().slice(0, 200)}`,
      );
    }
  }

  server.kill();

  console.log(`\n${passed}/${CASES.length} cases passed`);
  if (failures.length > 0) {
    console.log('\nMisses:\n');
    for (const failure of failures) console.log(`  ${failure}\n`);
  }
}

void main();
