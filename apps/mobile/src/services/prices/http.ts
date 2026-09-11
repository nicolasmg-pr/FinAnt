/**
 * The only place in FinAnt that opens a network connection.
 *
 * It is deliberately one small function rather than a client: everything the
 * app is allowed to fetch is a price, so there is one timeout, one failure
 * shape, and one file to read to know exactly what can leave the device.
 *
 * Every failure is null, never a throw. A price that could not be fetched is an
 * ordinary state of this feature — the owner may be on a plane, the provider
 * may have changed its endpoints — and the portfolio renders from its cache
 * with the age of that cache on screen. It must never become an error screen
 * over a figure the app already has a usable answer for.
 */

/** Long enough for a slow mobile connection, short enough not to hang a pull. */
const TIMEOUT_MS = 8000;

export async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
