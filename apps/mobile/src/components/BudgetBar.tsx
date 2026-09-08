import type { BudgetState } from '@finant/core';
import { Trail, type TrailPart } from './trail/Trail';

/**
 * A limit bar, not a share bar: the track is the monthly limit, so a full bar
 * always means "nothing left" regardless of the amounts involved. Colour comes
 * from the state the domain assigned, so the bar and the caption can never
 * disagree about whether a budget is in trouble.
 *
 * The grains are the app's accumulation form, but the colour is not `grain`:
 * a budget measures spending against a limit, which is not accumulation.
 */
export function BudgetBar({
  ratio,
  state,
  color,
}: {
  ratio: number;
  state: BudgetState;
  color?: string;
}) {
  // An infinite ratio is what core reports for a zero limit, and it means the
  // limit is entirely spent. segmentsFor treats broken input as nothing carried,
  // which is right in general and exactly wrong here.
  const safe = Number.isFinite(ratio) ? ratio : 1;

  const part: TrailPart =
    state === 'over'
      ? { ratio: safe, tone: 'expense' }
      : state === 'near'
        ? { ratio: safe, tone: 'warning' }
        : // The owner's own category colour when they have chosen one.
          { ratio: safe, tone: 'accent', color };

  return <Trail parts={[part]} state={state} />;
}
