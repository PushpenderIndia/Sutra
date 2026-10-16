import type { z } from 'zod';

export type EnvSource = Record<string, string | undefined>;

export class EnvError extends Error {
  override name = 'EnvError';
}

/** Validates `source` against `schema`, throwing one error that lists every missing or invalid key. */
export function parse<T extends z.ZodObject>(schema: T, source: EnvSource): z.infer<T> {
  // Empty values (`KEY=`) mean "unset", so defaults and optionals apply.
  const input = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.join('.');
    return `  - ${key}: ${input[key] === undefined ? 'missing' : issue.message}`;
  });
  throw new EnvError(`Invalid environment configuration:\n${lines.join('\n')}`);
}
