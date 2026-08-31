import type { ImportProfile } from '../profile';
import { GENERIC_CSV } from './generic';

export { GENERIC_CSV };
export { PRESUPUESTO_XLSX } from './presupuesto';

/**
 * CSV profiles, in detection order: specific first, generic last.
 * The `PresupuestoYYYY.xlsx` tracker is a workbook profile, not a CSV one, and
 * is applied directly rather than detected from a header row.
 */
export const BUILT_IN_PROFILES: readonly ImportProfile[] = [GENERIC_CSV];
