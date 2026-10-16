/**
 * Fills missing UI strings in every `messages/<locale>.json` from `messages/en.json` using
 * Gemini, keeping ICU placeholders intact.
 *
 *   pnpm i18n:translate              # every locale in i18n/config.ts
 *   pnpm i18n:translate ja zh th     # these (creates the files); then add them to LOCALES
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { env } from '@sutra/config';
import { z } from 'zod';
import { type Catalog, merge, missing, placeholders } from '../i18n/catalog.ts';
import { DEFAULT_LOCALE, LOCALES } from '../i18n/config.ts';

const MODEL =
  process.argv.find((a) => a.startsWith('--model='))?.slice(8) ?? 'gemini-flash-lite-latest';
const dir = new URL('../messages/', import.meta.url);
const read = (locale: string): Catalog => {
  const file = new URL(`${locale}.json`, dir);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

async function translate(locale: string, strings: Record<string, string>) {
  const prompt = [
    `Translate the values of this JSON object from English into the language with BCP-47 code "${locale}"`,
    'for the UI of Sutra, a B2B sales app. Keep it short, natural and consistent.',
    'Keep the keys. Keep ICU syntax exactly: {placeholders}, plural/select keywords and #.',
    'Do not translate the product name "Sutra" or brand names. Reply with JSON only.',
    JSON.stringify(strings, null, 2),
  ].join('\n');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const out = z.record(z.string(), z.string()).parse(JSON.parse(text));
  // Drop anything that lost a placeholder; it stays English and is retried next run.
  return Object.fromEntries(
    Object.entries(out).filter(
      ([k, v]) => k in strings && `${placeholders(v)}` === `${placeholders(strings[k] ?? '')}`,
    ),
  );
}

const source = read(DEFAULT_LOCALE);
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = args.length ? args : LOCALES.filter((l) => l !== DEFAULT_LOCALE);
for (const locale of targets) {
  const target = read(locale);
  const todo = missing(source, target);
  const count = Object.keys(todo).length;
  const done = count ? await translate(locale, todo) : {};
  writeFileSync(
    new URL(`${locale}.json`, dir),
    `${JSON.stringify(merge(source, target, done), null, 2)}\n`,
  );
  console.log(`${locale}: ${Object.keys(done).length}/${count} missing strings translated`);
}
