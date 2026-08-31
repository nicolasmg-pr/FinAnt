import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DB_KEY_ENTRY = 'finant.db.key';

/**
 * The SQLCipher passphrase for the local database.
 *
 * It is generated once on this device, stored in the iOS Keychain / Android
 * Keystore, and never leaves it. Losing it means losing the database — that is
 * the intended trade: there is no server-side copy to recover from, which is
 * exactly why nobody else can read the file either.
 */
export async function getOrCreateDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DB_KEY_ENTRY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (existing) return existing;

  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DB_KEY_ENTRY, key, {
    // THIS_DEVICE_ONLY keeps the key out of iCloud Keychain and out of any
    // device-to-device backup: the encrypted database is worthless elsewhere.
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

/** Wipes the database key. The encrypted file left behind is unreadable. */
export async function destroyDatabaseKey(): Promise<void> {
  await SecureStore.deleteItemAsync(DB_KEY_ENTRY);
}

const GOCARDLESS_ENTRY = 'finant.gocardless.credentials';

export interface GoCardlessCredentials {
  readonly secretId: string;
  readonly secretKey: string;
}

/**
 * GoCardless credentials belong to the device owner's own GoCardless account.
 * They are held in the secure enclave-backed store, never in AsyncStorage,
 * never in the bundle, and never written to the SQLite database.
 */
export async function saveGoCardlessCredentials(credentials: GoCardlessCredentials): Promise<void> {
  await SecureStore.setItemAsync(GOCARDLESS_ENTRY, JSON.stringify(credentials), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  });
}

export async function readGoCardlessCredentials(): Promise<GoCardlessCredentials | null> {
  const raw = await SecureStore.getItemAsync(GOCARDLESS_ENTRY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GoCardlessCredentials;
    return parsed.secretId && parsed.secretKey ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearGoCardlessCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(GOCARDLESS_ENTRY);
}
