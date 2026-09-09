import { matches, targetOf } from './categorise';
import { money } from './money';
import type { RuleMatch } from './types';

/**
 * Which of the owner's accounts a notification is about.
 *
 * A bank app is one notification channel for several accounts, so the account
 * cannot come from the package name alone. The discriminator lives in the text
 * — a card's last four digits, "Visa" against "Giro", an account nickname — and
 * is expressed as the same `RuleMatch` tree the categorisation and exclusion
 * rules use, evaluated by the same `matches()`. One matcher, three callers.
 */
export interface NotificationRoute {
  readonly id: string;
  readonly sourceId: string;
  readonly accountId: string;
  /** `null` marks the fallback: used only when no discriminator matched. */
  readonly match: RuleMatch | null;
  /** Higher wins. Ties break on route id for determinism. */
  readonly priority: number;
}

export interface RouteResolution {
  readonly accountId: string;
  readonly routeId: string;
  /**
   * True when no discriminator matched and the fallback took it. The inbox
   * flags these: the owner should either add a rule or move the movement.
   */
  readonly viaFallback: boolean;
}

function best(routes: readonly NotificationRoute[]): NotificationRoute | null {
  let winner: NotificationRoute | null = null;
  for (const route of routes) {
    if (
      winner === null ||
      route.priority > winner.priority ||
      (route.priority === winner.priority && route.id < winner.id)
    ) {
      winner = route;
    }
  }
  return winner;
}

/**
 * @param input the parsed notification's text and signed amount in minor units.
 *   The currency is irrelevant to routing and is not consulted.
 */
export function resolveRoute(
  input: { readonly text: string; readonly amountMinor: number },
  routes: readonly NotificationRoute[],
): RouteResolution | null {
  const target = targetOf({
    description: input.text,
    counterparty: null,
    reference: null,
    // Currency is not part of any routing decision; the matcher only reads
    // `amount.minor` for `amountBetween`.
    amount: money(input.amountMinor, 'EUR'),
  });

  const matched = routes.filter((route) => route.match !== null && matches(route.match, target));
  const winner = best(matched);
  if (winner) return { accountId: winner.accountId, routeId: winner.id, viaFallback: false };

  const fallback = best(routes.filter((route) => route.match === null));
  if (fallback) return { accountId: fallback.accountId, routeId: fallback.id, viaFallback: true };

  return null;
}
