import type { UiLocale } from './i18n/config';
import type messages from './messages/en.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: UiLocale;
    Messages: typeof messages;
  }
}
