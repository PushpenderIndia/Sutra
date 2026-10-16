import { z } from 'zod';
import { defineAgent } from '../agent.ts';
import { noFabrication } from '../prompts/base.ts';

/** People the contact finder pulls out of a company's own pages. */
export const extractedContacts = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().optional(),
        title: z.string().optional(),
        /** Only an address actually printed on the page; never a guess. */
        email: z.email().optional(),
      }),
    )
    .max(20),
});
export type ExtractedContacts = z.infer<typeof extractedContacts>;

/**
 * Reads a company's contact/about/team/leadership pages (passed as `<untrusted>` input) and pulls
 * out the people worth reaching, with any email that is actually published. It never invents an
 * address — pattern guessing and MX checks happen in code afterwards.
 */
export const contactExtractor = defineAgent({
  name: 'contactExtractor',
  description: "Extracts people and published emails from a company's own web pages.",
  model: 'sutra-fast',
  output: extractedContacts,
  temperature: 0.1,
  instruction: [
    "You read the text of a company's own website pages and list the people worth contacting for a B2B sales outreach: decision-makers, team members and named leaders.",
    noFabrication,
    'Rules:',
    '- Only include an `email` if it is literally written on the page. Never guess or construct an address.',
    '- Prefer named individuals over generic inboxes; include a generic inbox (info@, hello@) only if no person is listed.',
    '- Use the title exactly as written on the page.',
    '- Return at most 20 people.',
    'Reply with only the JSON object.',
  ],
});
