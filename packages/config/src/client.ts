import { parse } from './parse.ts';
import { clientSchema } from './schema.ts';

/** Browser-safe env. Next inlines each `process.env.NEXT_PUBLIC_*` reference at build time. */
export const clientEnv = parse(clientSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
