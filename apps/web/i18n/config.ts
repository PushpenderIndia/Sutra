/** UI languages (the user's), separate from each contact's content locale. */
export const LOCALES = ['en', 'hi', 'id'] as const;
export type UiLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: UiLocale = 'en';
export const LOCALE_COOKIE = 'sutra-locale';

/** Each language's name in itself, for the switcher. */
export const LOCALE_NAMES: Record<UiLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
};

export const isLocale = (value: unknown): value is UiLocale => LOCALES.includes(value as UiLocale);
