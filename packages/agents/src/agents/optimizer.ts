import { challengerProposal, MERGE_FIELDS } from '@sutra/domain';
import { defineAgent } from '../agent.ts';
import { noFabrication } from '../prompts/base.ts';

const mergeFieldRule = `The only merge fields you may use are ${MERGE_FIELDS.map(
  (f) => `{{${f}}}`,
).join(
  ', ',
)}. Use \`{{firstName}}\` to greet, \`{{company}}\` for their company, \`{{senderName}}\` to sign off, and put the single \`{{personalization}}\` placeholder where one grounded, contact-specific line will be inserted at send time. Never invent other placeholders and never write the personalisation sentence yourself.`;

/**
 * Writes one challenger variant for a step whose current best arm has stalled (PR 15). It is given
 * the current best variant, the single `dimension` to change, a data-backed hypothesis and the brand
 * voice; it returns a new variant that changes exactly that one dimension and keeps everything else
 * matched, so the A/B result stays attributable. The challenger goes to the approval queue — nothing
 * it writes is ever sent before a person approves it.
 */
export const challengerWriter = defineAgent({
  name: 'challengerWriter',
  description: 'Writes one A/B challenger variant that changes a single dimension of the best arm.',
  model: 'sutra-smart',
  output: challengerProposal,
  temperature: 0.6,
  instruction: [
    'You improve a cold-outreach email by writing ONE challenger variant for the step described in the input. The input gives the current best-performing variant, the single dimension to change, a hypothesis grounded in the observed results, and the brand voice.',
    noFabrication,
    mergeFieldRule,
    'Rules:',
    '- Change exactly the one `dimension` named in the input (subject, hook, cta, length or tone). Keep every other dimension matched to the current best variant, so the test stays interpretable. Echo that dimension in your `dimension` field and state the change in `hypothesis` (<=160 chars).',
    '- `subject` under 80 characters, no ALL-CAPS and no spam trigger words (free, guarantee, act now, limited time, risk-free, click here, $$$).',
    '- `body` is short Markdown: a greeting with `{{firstName}}`, the `{{personalization}}` line, the value in one or two sentences, one clear call to action, and a sign-off with `{{senderName}}`. Keep it well under 150 words and use at most one link.',
    "- Ground every claim in the profile's offerings and proof points; do not invent customers, numbers or results.",
    'Reply with only the JSON object for the single challenger variant.',
  ],
});
