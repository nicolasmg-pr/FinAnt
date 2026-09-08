# Ask bubble — a local assistant over the movements

Date: 2026-09-08
Status: approved, implementation in progress on `ask-bubble`

## What it is

A draggable bubble, present over every tab, that opens a chat sheet. The owner
types a question about their movements in English, Spanish or German; the answer
is a filtered movement list plus a computed total.

The model routes. It never computes. Every euro figure and every date bound on
screen is produced by `@finant/core` from a filter the model selected.

## Decisions

| Decision       | Choice                                                    |
| -------------- | --------------------------------------------------------- |
| Answer shape   | Filtered list plus computed total (sum / count / average) |
| Runtime        | `llama.rn` (llama.cpp), iOS and Android                   |
| Model          | Qwen3 1.7B Instruct Q4_K_M, 1.11 GB                       |
| Languages      | Model reads EN/ES/DE directly. No translation layer.      |
| Model delivery | In-app download from one pinned host, checksum-verified   |
| Turn semantics | Each turn patches the previous filter                     |
| Bubble         | Draggable, parks on an edge, position persisted           |

### Why no translation layer

The model emits JSON, not prose, so there is no answer to translate back — the
visible text is rendered by the app's typed i18n and `formatMoney`. Only the
input leg would need translating, and no on-device translator fits: ML Kit
downloads language packs over the network, Apple's framework is iOS-only, and a
second LLM is both another 400+ MB and itself a multilingual task. A
multilingual model removes the problem instead of moving it.

### Which repository, and why it is safe to use a community one

Qwen publishes GGUF conversions of 1.7B only at Q8_0, which is 1.8 GB — too much
to hold resident beside an encrypted database on a 6 GB phone. Q4_K_M exists in
bartowski's conversion, so that is where it comes from. The pinned SHA-256 is
what makes that acceptable: it is the digest Hugging Face publishes for the
file, the owner can compute it themselves, and any other bytes are refused
whatever they claim to be.

### Why the model never computes

A 1.7B model is unreliable at date arithmetic and at scaling euros to minor
units, and both errors would surface as a wrong figure rather than a wrong
result set. So:

- **Dates** — the model names an intent (`last-3-months`, `2026-07`), and
  `core/dates.ts` resolves the bounds with the already-tested `addMonths` and
  `dateRangePreset`.
- **Money** — the model emits `"50"` or `"12.50"`; `core/money.ts` `parseDecimal`
  converts. The model never multiplies by 100.
- **Ids** — the GBNF grammar is generated with the owner's real category and
  account ids as literal alternatives, so an invented id is unrepresentable, not
  merely rejected.

## Architecture

```
packages/assistant/           pure TypeScript, node-testable, no React/Expo/native
  src/schema.ts               model output types + JSON Schema (id enums baked in)
  src/prompt.ts               system prompt from locale, categories, accounts, today
  src/resolve.ts              patch -> TransactionFilter, the risky part
  src/answer.ts               filter + aggregate -> Answer (delegates to core)

apps/mobile/src/assistant/    native and platform
  model-file.ts               download, resume, SHA-256 verify, private storage
  runtime.ts                  llama.rn context lifecycle
  use-ask.ts                  hook

apps/mobile/src/components/
  AskBubble.tsx               draggable circle
  AskSheet.tsx                transcript, chips, total, list
```

`packages/core` gains nothing. The assistant is a caller.

## Turn contract

The model emits a patch, never a whole filter. An omitted key means unchanged,
so "and in July?" is a one-key emission and the category survives without the
model re-stating it. `reset: true` starts over.

```ts
interface FilterPatch {
  text?: string | null;
  accountIds?: readonly string[];
  categoryIds?: readonly string[];
  range?: RangeIntent;
  side?: TransactionSide | 'all';
  minEuros?: string | null;
  maxEuros?: string | null;
  aggregate?: 'sum' | 'count' | 'average' | 'none';
  reset?: boolean;
}
```

## What may enter the prompt

Permitted: today's date, the locale, category ids with the owner's labels,
account ids with the owner's names, the previous filter as JSON, the typed
message.

Forbidden: any transaction. No description, counterparty, reference, IBAN,
amount or balance.

This is enforced by signature. `buildPrompt` accepts `PromptCategory {id, name}`
and `PromptAccount {id, name}` — narrow types that cannot carry an IBAN or a
movement. Widening them is a visible API change.

The transcript lives in memory and dies with the sheet. This feature writes
nothing movement-derived to disk.

## Inference lifecycle

- Context loads on sheet open, releases on sheet close and on `AppState`
  background. 1.28 GB resident while backgrounded is a jetsam kill.
- Context stays alive between turns so the system prompt's KV cache is reused.
- `n_ctx` 2048.
- One generation at a time; a new message cancels the in-flight one.
- Metal on iOS, Hexagon NPU on Android where present, CPU otherwise.
- Load failure on a low-RAM device is a normal state: offer a smaller model.

## Model download, and what it costs

`docs/security-model.md` currently states as a defended property that the app
makes no network calls. This feature retires that, narrowly, and the document
must be corrected in the same commit.

Constraints that keep the exception narrow:

- One pinned host, checked at runtime. No iOS ATS change is needed: App
  Transport Security blocks _insecure_ connections, and this is ordinary HTTPS,
  so `NSAllowsArbitraryLoads` stays `false` with no exception domains. Android
  needs no manifest change either — Expo's default manifest already declares
  `android.permission.INTERNET`. Both of those were expected to be config
  changes during design and turned out not to be.
- SHA-256 pinned in source, verified before the model is marked installed.
  Mismatch deletes the file and refuses.
- Fires only on an explicit tap. No launch check, no background refresh, no
  update poll, no retry-on-launch. One gesture, one request, one file.
- No request body. No statement data is transmitted, ever.
- Stored in app-private, no-backup storage. Not encrypted: these are public
  weights, and SQLCipher is for the ledger.

Analytics, crash reporting and telemetry remain forbidden outright.

New setting keys: `SETTING_ASSISTANT_MODEL_PATH`, `SETTING_ASSISTANT_ENABLED`,
`SETTING_ASSISTANT_BUBBLE_POSITION`.

## Failure states

| State                            | Behaviour                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No model installed               | Bubble hidden. No dead affordance.                                                                      |
| Model loading                    | Bubble shows progress; sheet says loading.                                                              |
| Patch resolves to nothing usable | "I didn't understand that", plus a button opening the filter sheet prefilled with whatever did resolve. |
| Zero results                     | Say zero, keep the chips, offer to remove the last constraint.                                          |
| Generation over ~15 s            | Cancel, offer retry.                                                                                    |
| Load out of memory               | Suggest a smaller model, keep the picker.                                                               |

Every path degrades to the existing filter sheet, which this feature does not
touch.

## Testing

`packages/assistant/tests/` runs in node under vitest, with no phone and no
model: patch application, omitted-key semantics, `reset`, unknown-id rejection,
euro strings to minor units, every `RangeIntent` to bounds, prompt enum
contents, and the aggregate orientation.

Model quality cannot be CI-tested without shipping 1.28 GB. `npm run
eval:assistant` runs a fixture of phrasings across EN/ES/DE against an installed
model and prints a pass rate. It is a local eval, not a gate.

## Out of scope

No prose generation, no charts, no budget advice, no LLM categorisation (the
rules engine owns that), no persisted transcript.
