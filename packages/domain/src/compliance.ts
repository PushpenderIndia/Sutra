import { z } from 'zod';
import { doc, id } from './common.ts';

export const suppressionKind = z.enum(['opt_out', 'bounce', 'dnc', 'manual', 'erased']);

export const suppression = doc({
  kind: suppressionKind,
  /** `email_hash` keeps an erased person suppressed without storing their address. */
  scope: z.enum(['email', 'domain', 'email_hash']),
  /** Lower-cased email, domain or hash. */
  value: z.string().min(1).toLowerCase(),
  reason: z.string(),
  at: z.date(),
});
export type Suppression = z.infer<typeof suppression>;

export const lawfulBasis = z.enum(['consent', 'legitimate_interest', 'existing_customer']);

export const consent = doc({
  contactId: id,
  basis: lawfulBasis,
  /** How it was obtained, e.g. `public_page`, `form`, `import`. */
  source: z.string(),
  /** Evidence, e.g. the page URL the address was published on. */
  evidence: z.string(),
  at: z.date(),
});
export type Consent = z.infer<typeof consent>;
