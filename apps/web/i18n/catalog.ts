/** Message catalogs as nested objects, and the pure helpers `pnpm i18n:translate` uses. */
export type Catalog = { [key: string]: string | Catalog };

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`. */
export function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([k, v]) =>
      typeof v === 'string' ? [[prefix + k, v]] : Object.entries(flatten(v, `${prefix}${k}.`)),
    ),
  );
}

/** Keys in `source` that `target` lacks (or has empty), with their source strings. */
export function missing(source: Catalog, target: Catalog): Record<string, string> {
  const have = flatten(target);
  return Object.fromEntries(Object.entries(flatten(source)).filter(([k]) => !have[k]?.trim()));
}

/**
 * `target` with `translations` filled in, shaped and ordered like `source`. Keys no longer in
 * `source` are dropped, so the catalogs never drift.
 */
export function merge(
  source: Catalog,
  target: Catalog,
  translations: Record<string, string>,
  prefix = '',
): Catalog {
  const have = flatten(target);
  return Object.fromEntries(
    Object.entries(source).map(([k, v]) => {
      const key = prefix + k;
      if (typeof v !== 'string') return [k, merge(v, target, translations, `${key}.`)];
      return [k, have[key]?.trim() ? have[key] : (translations[key] ?? v)];
    }),
  );
}

/** ICU placeholders (`{count}`, `#`) a translation must keep. */
export const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
