import type { ImportProfile } from '../profile';
import { GENERIC_CSV } from './generic';
import { GOOGLE_SHEETS_TRACKER } from './google-sheets';

export { GENERIC_CSV, GOOGLE_SHEETS_TRACKER };

/** Detection order: specific profiles first, generic last. */
export const BUILT_IN_PROFILES: readonly ImportProfile[] = [GOOGLE_SHEETS_TRACKER, GENERIC_CSV];
