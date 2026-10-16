import { z } from 'zod';

/** A Mongo ObjectId as a 24-char hex string. Every `_id` and reference uses it. */
export const id = z.string().regex(/^[a-f0-9]{24}$/);
export const locale = z.enum(['en', 'hi', 'id', 'ms', 'th', 'vi', 'fil', 'ja', 'ko', 'zh', 'ta']);
/** ISO-3166 alpha-2, upper case. */
export const country = z.string().regex(/^[A-Z]{2}$/);
export const source = z.enum([
  'search',
  'lookalike',
  'places',
  'registry',
  'csv',
  'apollo',
  'hunter',
  'chat',
]);
/** IANA time zone, e.g. `Asia/Jakarta`. */
export const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone');
/** `HH:MM`, 24-hour. */
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Better Auth user id. */
export const userId = z.string().min(1);
export const count = z.int().min(0);
export const usd = z.number().min(0);

/** Fields every stored document has. `workspaceId` scopes every read and write. */
export const base = { _id: id, workspaceId: id, createdAt: z.date(), updatedAt: z.date() };
export const BASE_KEYS = Object.keys(base) as (keyof typeof base)[];

/** A collection document schema: `base` plus the collection's own fields. */
export const doc = <T extends z.ZodRawShape>(shape: T) => z.object({ ...base, ...shape });

export type Id = z.infer<typeof id>;
export type Locale = z.infer<typeof locale>;
export type Country = z.infer<typeof country>;
export type Source = z.infer<typeof source>;
export type Base = z.infer<z.ZodObject<typeof base>>;
