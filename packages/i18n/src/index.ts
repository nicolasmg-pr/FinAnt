import { de } from './de';
import { en } from './en';
import { es } from './es';

export type { Resources } from './en';
export type { Translations } from './types';
export { en, es, de };

export const SUPPORTED_LOCALES = ['en', 'es', 'de'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const resources = {
  en: { translation: en },
  es: { translation: es },
  de: { translation: de },
} as const;

/** BCP 47 tags used for Intl number, currency and date formatting per locale. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-IE',
  es: 'es-ES',
  de: 'de-DE',
};

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Maps a device language tag such as `de-AT` or `es-419` onto a supported locale. */
export function resolveLocale(deviceTags: readonly string[]): Locale {
  for (const tag of deviceTags) {
    const base = tag.toLowerCase().split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
