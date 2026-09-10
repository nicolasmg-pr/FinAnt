import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, INTL_LOCALE, isLocale, resources, type Locale } from '@finant/i18n';
import { readSetting, SETTING_LOCALE, writeSetting } from '../db/settings-repo';

/** Device languages, best match first, mapped onto a supported locale. */
function deviceLocale(): Locale {
  for (const locale of getLocales()) {
    const base = locale.languageCode?.toLowerCase() ?? '';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * i18next is initialised at import time, not inside `initI18n`.
 *
 * The root layout calls `useTranslation()` on its first render, which happens
 * before any effect has run: an instance registered later leaves that render
 * without one, and react-i18next warns and echoes the keys. Every resource is
 * bundled, so this needs no await — only the stored language does, and that is
 * what `initI18n` applies afterwards.
 */
i18n.use(initReactI18next).init({
  resources,
  lng: deviceLocale(),
  fallbackLng: DEFAULT_LOCALE,
  // React already escapes everything it renders.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Applies the language stored in the database over the device's default. */
export async function initI18n(): Promise<Locale> {
  const stored = await readSetting(SETTING_LOCALE);
  const initial = stored && isLocale(stored) ? stored : deviceLocale();
  if (initial !== i18n.language) await i18n.changeLanguage(initial);
  return initial;
}

/** Changes the language and remembers the choice across launches. */
export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  await writeSetting(SETTING_LOCALE, locale);
}

export function currentLocale(): Locale {
  const language = i18n.language;
  return isLocale(language) ? language : DEFAULT_LOCALE;
}

/** BCP 47 tag for Intl formatting — de-DE, es-ES, en-IE. */
export function intlLocale(): string {
  return INTL_LOCALE[currentLocale()];
}

/**
 * Formats a plain `YYYY-MM-DD` for display. Parsed and formatted in UTC on both
 * ends, so the calendar day never shifts with the device's time zone.
 */
export function formatBookingDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(), { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export { i18n };
