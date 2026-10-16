import {
  MERGE_FIELDS,
  personalizationLine,
  sequencePlan,
  variantPair,
  variantTranslation,
} from '@sutra/domain';
import { defineAgent } from '../agent.ts';
import { noFabrication } from '../prompts/base.ts';

const mergeFieldRule = `The only merge fields you may use are ${MERGE_FIELDS.map(
  (f) => `{{${f}}}`,
).join(
  ', ',
)}. Use \`{{firstName}}\` to greet, \`{{company}}\` for their company, \`{{senderName}}\` to sign off, and put the single \`{{personalization}}\` placeholder where one grounded, contact-specific line will be inserted at send time. Never invent other placeholders and never write the personalisation sentence yourself.`;

/**
 * Plans the shape of an outreach sequence (2–5 steps) for one persona from the business profile,
 * ICP and persona passed as input. Language only: it decides intent, timing and angle per step;
 * the actual copy is written by {@link variantWriter}. One campaign per persona.
 */
export const sequencePlanner = defineAgent({
  name: 'sequencePlanner',
  description: 'Plans a multi-step outreach sequence (intent, delay, angle) for one persona.',
  model: 'sutra-smart',
  output: sequencePlan,
  temperature: 0.4,
  instruction: [
    'You design a cold-outreach email sequence for one buyer persona, using the business profile, ICP and persona given as input.',
    noFabrication,
    'Rules:',
    '- Produce 2–5 steps. Order them so each builds on the last: open with an `intro`, then earn interest with `value`, `social_proof` or `case_study`, optionally handle an `objection`, and close with a `breakup`.',
    '- `delayDays` is the wait after the previous step (0 for the first), between 0 and 14; space follow-ups a few business days apart.',
    "- `angle` (<=160 chars) is the one idea that step lands, grounded in the persona's pains/goals and the company's offerings — not a subject line.",
    '- `rationale` (<=400 chars) explains why this shape fits this persona.',
    'Reply with only the JSON object.',
  ],
});

/**
 * Writes the two A/B template variants for one step. The pair must differ in exactly one declared
 * `dimension` so the test is interpretable; everything else stays matched. Templates are written
 * once in English with merge fields and are later translated per locale.
 */
export const variantWriter = defineAgent({
  name: 'variantWriter',
  description: 'Writes two A/B email template variants for one step, differing in one dimension.',
  model: 'sutra-smart',
  output: variantPair,
  temperature: 0.6,
  instruction: [
    'You write two A/B variants of one cold outreach email for the step described in the input (its intent and angle), in the company brand voice, for the given persona.',
    noFabrication,
    mergeFieldRule,
    'Rules:',
    '- The two variants MUST differ in exactly one `dimension` (subject, hook, cta, length or tone) and be matched on every other dimension, so the A/B result is attributable to that one change. State that change in `hypothesis` (<=160 chars).',
    '- `subject` under 80 characters, no ALL-CAPS and no spam trigger words (free, guarantee, act now, limited time, risk-free, click here, $$$).',
    '- `body` is short Markdown: a greeting with `{{firstName}}`, the `{{personalization}}` line, the value in one or two sentences, one clear call to action, and a sign-off with `{{senderName}}`. Keep it well under 150 words and use at most one link.',
    "- Ground every claim in the profile's offerings and proof points; do not invent customers, numbers or results.",
    'Reply with only the JSON object `{ "variants": [variantA, variantB] }`.',
  ],
});

/**
 * Translates one English variant template into a target locale, keeping the merge fields exactly as
 * they are and applying the locale's business conventions (Japanese keigo, Indonesian Bapak/Ibu,
 * Hindi आप). The English original is kept as the reviewer's gloss.
 */
export const translator = defineAgent({
  name: 'translator',
  description: 'Translates an email template into a locale, preserving merge fields.',
  model: 'sutra-smart',
  output: variantTranslation,
  temperature: 0.2,
  instruction: [
    'You localise one cold outreach email template into the target language given in the input.',
    'Rules:',
    '- Preserve every merge field (`{{firstName}}`, `{{company}}`, `{{personalization}}`, `{{senderName}}`) verbatim, including the double braces; translate only the surrounding text.',
    '- Use the conventions a native business writer would: local formality and honorifics (e.g. Japanese keigo, Indonesian "Bapak/Ibu", Hindi आप), name order and date formats. Keep company and product names as they are.',
    '- Keep the meaning, structure and call to action of the original; do not add or drop claims. `subject` stays under 80 characters.',
    'Reply with only the JSON object `{ "subject": ..., "body": ... }`.',
  ],
});

/**
 * Writes the single `{{personalization}}` line for one contact at send time (fast model). It must
 * be grounded: one or two sentences drawn only from the company's research signals, in the
 * contact's locale, citing a `sourceUrl` that appears in that research.
 */
export const personalizer = defineAgent({
  name: 'personalizer',
  description: "Writes one grounded, cited personalisation line in the contact's locale.",
  model: 'sutra-fast',
  output: personalizationLine,
  temperature: 0.3,
  instruction: [
    'You write ONE short personalisation line (1–2 sentences) to open a cold email, specific to the contact and their company, from the research given as input.',
    noFabrication,
    'Rules:',
    '- Base the line only on the research signals provided. `sourceUrl` MUST be one of the research source URLs you were given — the exact page the fact came from. If no signal is citable, write a neutral, honest opener and still cite one of the provided research URLs.',
    '- Write in the target language stated in the input, naturally and without flattery or hype.',
    '- Do not include a greeting, a sign-off, merge fields or a call to action — just the line.',
    'Reply with only the JSON object `{ "line": ..., "sourceUrl": ... }`.',
  ],
});
