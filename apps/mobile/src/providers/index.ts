import { goCardlessDeviceProvider } from './gocardless';
import type { BankProvider } from './bank-provider';

export * from './bank-provider';
export { goCardlessDeviceProvider, resetGoCardlessToken } from './gocardless';

/** The provider the app uses. Swap here when moving to a broker-backed build. */
export const bankProvider: BankProvider = goCardlessDeviceProvider;
