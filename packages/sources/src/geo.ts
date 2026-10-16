import type { Country, Locale } from '@sutra/domain';

/** IANA time zone per country, for the markets Sutra targets; `Asia/Singapore` is the fallback. */
const TIMEZONE: Partial<Record<Country, string>> = {
  SG: 'Asia/Singapore',
  ID: 'Asia/Jakarta',
  VN: 'Asia/Ho_Chi_Minh',
  MY: 'Asia/Kuala_Lumpur',
  TH: 'Asia/Bangkok',
  PH: 'Asia/Manila',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  IN: 'Asia/Kolkata',
  AU: 'Australia/Sydney',
  GB: 'Europe/London',
  US: 'America/New_York',
};

/** Default outreach locale per country; English where we have no better guess. */
const LOCALE: Partial<Record<Country, Locale>> = {
  ID: 'id',
  VN: 'vi',
  MY: 'ms',
  TH: 'th',
  PH: 'fil',
  JP: 'ja',
  KR: 'ko',
  IN: 'hi',
};

export const timezoneForCountry = (country: Country): string =>
  TIMEZONE[country] ?? 'Asia/Singapore';

export const localeForCountry = (country: Country): Locale => LOCALE[country] ?? 'en';
