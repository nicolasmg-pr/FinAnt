import { describe, expect, it } from 'vitest';
import { resolveRoute, type NotificationRoute } from '../src/notification-routing';

const visa: NotificationRoute = {
  id: 'r-visa',
  sourceId: 's-dkb',
  accountId: 'acc-visa',
  match: { kind: 'word', field: 'any', value: 'visa' },
  priority: 100,
};

const giro: NotificationRoute = {
  id: 'r-giro',
  sourceId: 's-dkb',
  accountId: 'acc-giro',
  match: null,
  priority: 100,
};

describe('resolveRoute', () => {
  it('routes on a discriminator in the text', () => {
    const result = resolveRoute({ text: 'Visa payment of 12,34 EUR', amountMinor: -1234 }, [
      visa,
      giro,
    ]);
    expect(result).toEqual({ accountId: 'acc-visa', routeId: 'r-visa', viaFallback: false });
  });

  it('falls back when no discriminator matches', () => {
    const result = resolveRoute({ text: 'Zahlung 12,34 EUR', amountMinor: -1234 }, [visa, giro]);
    expect(result).toEqual({ accountId: 'acc-giro', routeId: 'r-giro', viaFallback: true });
  });

  it('returns null when nothing matches and there is no fallback', () => {
    expect(resolveRoute({ text: 'Zahlung', amountMinor: -1234 }, [visa])).toBeNull();
  });

  it('returns null for no routes at all', () => {
    expect(resolveRoute({ text: 'Zahlung', amountMinor: -1234 }, [])).toBeNull();
  });

  it('prefers the higher priority route', () => {
    const specific: NotificationRoute = {
      id: 'r-gold',
      sourceId: 's-dkb',
      accountId: 'acc-gold',
      match: { kind: 'word', field: 'any', value: 'visa' },
      priority: 500,
    };
    const result = resolveRoute({ text: 'Visa payment', amountMinor: -1234 }, [visa, specific]);
    expect(result?.accountId).toBe('acc-gold');
  });

  it('breaks a priority tie on route id, so two runs agree', () => {
    const other: NotificationRoute = { ...visa, id: 'r-aaa', accountId: 'acc-other' };
    const result = resolveRoute({ text: 'Visa payment', amountMinor: -1234 }, [visa, other]);
    expect(result?.routeId).toBe('r-aaa');
  });

  it('can route on the amount, for a savings plan of a known size', () => {
    const plan: NotificationRoute = {
      id: 'r-plan',
      sourceId: 's-tr',
      accountId: 'acc-depot',
      match: { kind: 'amountBetween', minMinor: -50000, maxMinor: -49999 },
      priority: 200,
    };
    const result = resolveRoute({ text: 'Sparplan ausgefuehrt', amountMinor: -50000 }, [
      plan,
      giro,
    ]);
    expect(result?.accountId).toBe('acc-depot');
  });

  it('ignores accents and case, like every other rule in the app', () => {
    const spanish: NotificationRoute = {
      id: 'r-es',
      sourceId: 's-open',
      accountId: 'acc-es',
      match: { kind: 'contains', field: 'any', value: 'nomina' },
      priority: 100,
    };
    const result = resolveRoute({ text: 'Ingreso de NÓMINA', amountMinor: 250000 }, [spanish]);
    expect(result?.accountId).toBe('acc-es');
  });
});
