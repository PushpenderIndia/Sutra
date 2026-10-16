import type { Locale } from '@sutra/domain';
import { z } from 'zod';
import { type EvalReport, metric, ratio } from '../framework.ts';

/**
 * Copilot eval (PR 16): 20 plain-language instructions, each labelled with the tool a competent model
 * should call and the arguments it should pass. The copilot's tools are the app's Server Actions, so a
 * tool is identified by name and its arguments are the action's Zod input.
 *
 * Offline (CI), this checks dataset integrity — every labelled tool exists and every labelled argument
 * set validates against that tool's schema, i.e. the "correct arguments" really are acceptable to the
 * action. The tool-selection accuracy of the live model is measured by `pnpm eval copilot --live`
 * (and the end-to-end routing + confirmation path is exercised against the mock proxy in
 * `evals/evals.test.ts`).
 */

/** A representative slice of the copilot tool catalogue (name → the action's Zod input). */
export const copilotTools: Record<string, z.ZodObject> = {
  search_prospects: z.object({ query: z.string().min(1) }),
  explain_score: z.object({ contactId: z.string().min(1) }),
  exclude_prospects: z.object({ contactIds: z.array(z.string().min(1)).min(1) }),
  pause_campaign: z.object({ campaignId: z.string().min(1) }),
  resume_campaign: z.object({ campaignId: z.string().min(1) }),
  rewrite_step: z.object({
    campaignId: z.string().min(1),
    stepIndex: z.number().int().min(0),
    instruction: z.string().min(1),
  }),
  update_business_profile: z.object({
    oneLiner: z.string().min(1).optional(),
    toneOfVoice: z.string().optional(),
  }),
  approve_variant: z.object({
    campaignId: z.string().min(1),
    stepIndex: z.number().int().min(0),
    variantId: z.string().min(1),
  }),
  book_meeting: z.object({ leadId: z.string().min(1), startsAt: z.string().min(1) }),
  approve_reply: z.object({ messageId: z.string().min(1) }),
};

export interface CopilotCase {
  instruction: string;
  locale: Locale;
  tool: keyof typeof copilotTools;
  args: Record<string, unknown>;
  /** Mutations must be gated by a confirmation card before they run. */
  mutation: boolean;
}

export const copilotCases: CopilotCase[] = [
  {
    instruction: 'Find prospects at coffee chains in Jakarta',
    locale: 'en',
    tool: 'search_prospects',
    args: { query: 'coffee chains Jakarta' },
    mutation: false,
  },
  {
    instruction: 'Why is Kopi Nusantara a strong fit?',
    locale: 'en',
    tool: 'explain_score',
    args: { contactId: 'contact-kopi' },
    mutation: false,
  },
  {
    instruction: 'Remove these three leads from the list',
    locale: 'en',
    tool: 'exclude_prospects',
    args: { contactIds: ['c1', 'c2', 'c3'] },
    mutation: true,
  },
  {
    instruction: 'Pause the autumn campaign',
    locale: 'en',
    tool: 'pause_campaign',
    args: { campaignId: 'camp-autumn' },
    mutation: true,
  },
  {
    instruction: 'Resume the autumn campaign',
    locale: 'en',
    tool: 'resume_campaign',
    args: { campaignId: 'camp-autumn' },
    mutation: true,
  },
  {
    instruction: 'Rewrite step 2 to be more casual',
    locale: 'en',
    tool: 'rewrite_step',
    args: { campaignId: 'camp-autumn', stepIndex: 1, instruction: 'more casual' },
    mutation: true,
  },
  {
    instruction: 'Update our one-liner to focus on packaging speed',
    locale: 'en',
    tool: 'update_business_profile',
    args: { oneLiner: 'Fast packaging reorders for growing F&B outlets' },
    mutation: true,
  },
  {
    instruction: 'Approve the new challenger on step 1',
    locale: 'en',
    tool: 'approve_variant',
    args: { campaignId: 'camp-autumn', stepIndex: 0, variantId: 'var-9' },
    mutation: true,
  },
  {
    instruction: 'Book the meeting with Mei for Tuesday 2pm',
    locale: 'en',
    tool: 'book_meeting',
    args: { leadId: 'lead-mei', startsAt: '2026-10-20T14:00:00+08:00' },
    mutation: true,
  },
  {
    instruction: 'Send the drafted reply to that lead',
    locale: 'en',
    tool: 'approve_reply',
    args: { messageId: 'msg-77' },
    mutation: true,
  },
  // Other languages (the copilot answers in the user's language).
  {
    instruction: 'Cari prospek restoran di Surabaya',
    locale: 'id',
    tool: 'search_prospects',
    args: { query: 'restoran Surabaya' },
    mutation: false,
  },
  {
    instruction: 'Jeda kampanye musim gugur',
    locale: 'id',
    tool: 'pause_campaign',
    args: { campaignId: 'camp-autumn' },
    mutation: true,
  },
  {
    instruction: 'Tulis ulang langkah 3 agar lebih singkat',
    locale: 'id',
    tool: 'rewrite_step',
    args: { campaignId: 'camp-autumn', stepIndex: 2, instruction: 'lebih singkat' },
    mutation: true,
  },
  {
    instruction: 'कंपनी का एक-लाइनर अपडेट करें',
    locale: 'hi',
    tool: 'update_business_profile',
    args: { oneLiner: 'तेज़ पैकेजिंग रीऑर्डर' },
    mutation: true,
  },
  {
    instruction: 'इस लीड को सूची से हटाएँ',
    locale: 'hi',
    tool: 'exclude_prospects',
    args: { contactIds: ['c9'] },
    mutation: true,
  },
  {
    instruction: 'Why did we score this contact so low?',
    locale: 'en',
    tool: 'explain_score',
    args: { contactId: 'contact-low' },
    mutation: false,
  },
  {
    instruction: 'Find decision-makers at bakeries in Singapore',
    locale: 'en',
    tool: 'search_prospects',
    args: { query: 'bakeries Singapore decision-makers' },
    mutation: false,
  },
  {
    instruction: 'Resume the campaign we paused yesterday',
    locale: 'en',
    tool: 'resume_campaign',
    args: { campaignId: 'camp-paused' },
    mutation: true,
  },
  {
    instruction: 'Approve that reply draft',
    locale: 'en',
    tool: 'approve_reply',
    args: { messageId: 'msg-88' },
    mutation: true,
  },
  {
    instruction: 'Rewrite the first email to lead with a number',
    locale: 'en',
    tool: 'rewrite_step',
    args: { campaignId: 'camp-autumn', stepIndex: 0, instruction: 'lead with a number' },
    mutation: true,
  },
];

/** Read-only tools: never a mutation, so never a confirmation card. */
export const READ_TOOLS = new Set<keyof typeof copilotTools>(['search_prospects', 'explain_score']);

/** Offline integrity: labelled tool exists, labelled args validate, and the mutation flag is correct. */
export function evaluateCopilot(): EvalReport {
  const toolExists = copilotCases.filter((c) => c.tool in copilotTools);
  const argsValid = copilotCases.filter((c) => copilotTools[c.tool]?.safeParse(c.args).success);
  // A case is consistent when its mutation flag matches whether the tool is read-only.
  const mutationConsistent = copilotCases.filter((c) => c.mutation === !READ_TOOLS.has(c.tool));
  return {
    agent: 'copilot',
    description: `${copilotCases.length} instructions, each labelled with the expected tool and arguments`,
    cases: copilotCases.length,
    metrics: [
      metric('labelled tool exists', ratio(toolExists.length, copilotCases.length), 1, {
        note: `${toolExists.length}/${copilotCases.length}`,
      }),
      metric('labelled args valid', ratio(argsValid.length, copilotCases.length), 1, {
        note: `${argsValid.length}/${copilotCases.length} parse against the action schema`,
      }),
      metric('mutation flag consistent', ratio(mutationConsistent.length, copilotCases.length), 1, {
        note: `${mutationConsistent.length}/${copilotCases.length} (mutations gated by a confirm card)`,
      }),
    ],
  };
}
