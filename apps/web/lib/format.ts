/** Region name for an ISO country code in `locale` ("ID" → "Indonesia"). */
export const regionName = (locale: string, code: string) =>
  new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;

/** A share as a whole percent, or an en dash when there's no denominator. */
export const percent = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
