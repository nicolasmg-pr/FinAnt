import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  INITIAL_STATE,
  answer,
  applyPatch,
  parsePatch,
  type Answer,
  type AskContext,
  type AskIssue,
  type AskState,
  type PromptAccount,
  type PromptCategory,
} from '@finant/assistant';
import type { ISODate, Transaction } from '@finant/core';
import { QWEN3_1_7B, isDownloaded } from './model-file';
import { OutOfMemoryError, ask, cancel, isLoaded, loadModel, unloadModel } from './runtime';

/** How long a turn may run before it is abandoned. */
const TURN_TIMEOUT_MS = 15_000;

export type AskStatus =
  'no-model' | 'loading-model' | 'idle' | 'thinking' | 'out-of-memory' | 'failed';

export interface AskTurn {
  readonly id: string;
  readonly question: string;
  /** `null` while the turn is still running, or when it produced nothing usable. */
  readonly result: Answer | null;
  readonly issues: readonly AskIssue[];
  readonly understood: boolean;
}

/**
 * The owner's calendar day.
 *
 * Deliberately not `toISOString()`: that is UTC, and west of UTC it hands the
 * model yesterday, which turns "this month" into the wrong month on the first
 * of it. Read off the local fields instead, and no Date crosses into the
 * domain — what leaves here is a plain `YYYY-MM-DD`.
 */
function localToday(): ISODate {
  const now = new Date();
  return [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export interface UseAskOptions {
  /** The sheet is open. The model is resident only while this is true. */
  readonly open: boolean;
  readonly transactions: readonly Transaction[];
  // Narrow on purpose. `Account` carries an IBAN and `Category` a good deal
  // more; taking only what the prompt may contain means nothing wider is in
  // scope at the point where the prompt is built.
  readonly categories: readonly PromptCategory[];
  readonly accounts: readonly PromptAccount[];
  readonly currency: string;
  readonly locale: string;
  /** Resolves a category id to the label the owner sees, in their language. */
  readonly labelFor: (categoryId: string) => string;
}

export interface UseAsk {
  readonly status: AskStatus;
  /** 0..1 while the weights are loading. */
  readonly loadProgress: number;
  readonly turns: readonly AskTurn[];
  readonly state: AskState;
  readonly send: (question: string) => Promise<void>;
  readonly reset: () => void;
  readonly stop: () => Promise<void>;
}

/**
 * One conversation over the movements.
 *
 * The model is loaded when the sheet opens and released when it closes or the
 * app goes to the background — 1.3 GB resident behind a backgrounded app is a
 * jetsam kill, and the owner would come back to a dead process rather than a
 * dead sheet.
 *
 * Nothing here computes a figure. A turn produces a filter; `answer()` runs it
 * through `@finant/core`, which is the same code the movements list and the
 * dashboard use.
 */
export function useAsk(options: UseAskOptions): UseAsk {
  const { open, transactions, categories, accounts, currency, locale, labelFor } = options;

  const [status, setStatus] = useState<AskStatus>('no-model');
  const [loadProgress, setLoadProgress] = useState(0);
  const [turns, setTurns] = useState<readonly AskTurn[]>([]);
  const [state, setState] = useState<AskState>(INITIAL_STATE);

  // Read inside async work that outlives the render it started in.
  const latest = useRef({ transactions, categories, accounts, currency, locale, state, labelFor });
  latest.current = { transactions, categories, accounts, currency, locale, state, labelFor };

  /* -- the model's lifetime ------------------------------------------------ */

  useEffect(() => {
    if (!open) {
      void unloadModel();
      setStatus(isDownloaded(QWEN3_1_7B) ? 'idle' : 'no-model');
      return;
    }

    if (!isDownloaded(QWEN3_1_7B)) {
      setStatus('no-model');
      return;
    }

    let alive = true;
    setStatus('loading-model');
    setLoadProgress(0);

    void loadModel(QWEN3_1_7B, (fraction) => {
      if (alive) setLoadProgress(fraction);
    })
      .then(() => {
        if (alive) setStatus('idle');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setStatus(error instanceof OutOfMemoryError ? 'out-of-memory' : 'failed');
      });

    return () => {
      alive = false;
      void unloadModel();
    };
  }, [open]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && isLoaded()) {
        void unloadModel();
        setStatus(isDownloaded(QWEN3_1_7B) ? 'idle' : 'no-model');
      }
    });
    return () => subscription.remove();
  }, []);

  /* -- a turn -------------------------------------------------------------- */

  const send = useCallback(async (question: string): Promise<void> => {
    const trimmed = question.trim();
    if (trimmed === '') return;

    const current = latest.current;
    const id = `${Date.now()}-${current.state.filter.text}-${trimmed.length}`;
    const pending: AskTurn = {
      id,
      question: trimmed,
      result: null,
      issues: [],
      understood: true,
    };
    setTurns((previous) => [...previous, pending]);
    setStatus('thinking');

    const ctx: AskContext = {
      today: localToday(),
      currency: current.currency,
      categoryIds: current.categories.map((category) => category.id),
      accountIds: current.accounts.map((account) => account.id),
    };

    const timeout = setTimeout(() => {
      void cancel();
    }, TURN_TIMEOUT_MS);

    try {
      const raw = await ask(
        {
          today: ctx.today,
          locale: current.locale,
          // Only an id and a label leave for the model. The narrow parameter
          // types in `@finant/assistant` are what make that checkable, but
          // mapping here means nothing wider is even in scope.
          categories: current.categories.map((category) => ({
            id: category.id,
            name: current.labelFor(category.id),
          })),
          accounts: current.accounts.map((account) => ({
            id: account.id,
            name: account.name,
          })),
          state: current.state,
          message: trimmed,
        },
        { categoryIds: ctx.categoryIds, accountIds: ctx.accountIds },
      );

      const parsed = parsePatch(raw);
      const understood =
        parsed.issues.every((issue) => issue.kind !== 'malformed-output') &&
        Object.keys(parsed.patch).length > 0;

      const resolved = applyPatch(current.state, parsed.patch, ctx);
      const result = understood ? answer(current.transactions, resolved.state, ctx) : null;

      if (understood) setState(resolved.state);

      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                result,
                understood,
                issues: [...parsed.issues, ...resolved.issues, ...(result?.issues ?? [])],
              }
            : turn,
        ),
      );
      setStatus('idle');
    } catch {
      setTurns((previous) =>
        previous.map((turn) => (turn.id === id ? { ...turn, understood: false } : turn)),
      );
      setStatus('idle');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const reset = useCallback(() => {
    setTurns([]);
    setState(INITIAL_STATE);
  }, []);

  const stop = useCallback(async () => {
    await cancel();
    setStatus('idle');
  }, []);

  return { status, loadProgress, turns, state, send, reset, stop };
}
