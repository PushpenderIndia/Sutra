import 'server-only';
import type { ChatToolSpec } from '@sutra/agents';
import type { z } from 'zod';
import { saveIcp, saveProfile } from '@/actions/business';
import {
  approveCampaign,
  editVariant,
  pauseCampaign,
  regenerateVariants,
  resumeCampaign,
  setContactPaused,
} from '@/actions/campaigns';
import {
  explainScore,
  getCampaignStats,
  getCompany,
  getThread,
  getVariantInsights,
  searchProspects,
} from '@/actions/chat';
import { approveReplyDraft, bookSuggestedMeeting } from '@/actions/leads';
import { excludeProspects } from '@/actions/prospects';
import type { Action } from '@/lib/action';

/**
 * The chat copilot's tools ARE the app's Server Actions — one definition, many uses. Each entry wraps
 * an existing action: the tool's parameters are the action's own Zod schema, and `execute` runs the
 * action under the signed-in user's session, so auth and role checks are identical to the UI. Nothing
 * here re-implements business logic; it only describes each action to the model. Mutations set
 * `confirm`, which becomes an ADK confirmation gate (a confirm card in chat) before anything runs.
 */

/** Turns one action into a chat-tool spec, carrying its exact input schema through to the model. */
function toSpec<I extends z.ZodObject, O>(
  name: string,
  action: Action<I, O>,
  opts: { describe: string; confirm?: boolean },
): ChatToolSpec {
  return {
    name,
    description: opts.describe,
    confirm: opts.confirm,
    parameters: action.input,
    execute: async (args) => {
      const result = await action(args as z.input<I>);
      return result.ok ? result.data : { error: result.error, code: result.code };
    },
  };
}

/** Every Server Action exposed to the copilot, read tools and (confirmed) mutations alike. */
export function chatToolSpecs(): ChatToolSpec[] {
  return [
    // Read-only — answer questions, no confirmation.
    toSpec('search_prospects', searchProspects, {
      describe: 'Find prospect companies by name/keyword, country, status or minimum score.',
    }),
    toSpec('get_company', getCompany, {
      describe: 'Get one company profile and its research by company id.',
    }),
    toSpec('explain_score', explainScore, {
      describe: 'Explain why a company scored as it did: the fit, the reasons and their evidence.',
    }),
    toSpec('get_campaign_stats', getCampaignStats, {
      describe: 'Per-campaign, per-step variant stats and the winning variant by reply rate.',
    }),
    toSpec('get_variant_insights', getVariantInsights, {
      describe: "The A/B hypotheses and stats for a campaign's variants, optionally one step.",
    }),
    toSpec('get_thread', getThread, {
      describe: 'The full email thread with one lead, by contact id, with reply analysis.',
    }),

    // Mutations — each requires the user to confirm in chat before it runs.
    toSpec('update_profile', saveProfile, {
      describe: 'Edit the business profile (saves a new draft version).',
      confirm: true,
    }),
    toSpec('update_icp', saveIcp, {
      describe: 'Edit the ideal customer profile — firmographics, personas, disqualifiers.',
      confirm: true,
    }),
    toSpec('exclude_prospects', excludeProspects, {
      describe: 'Exclude prospect companies from the campaign, by company ids or by country.',
      confirm: true,
    }),
    toSpec('edit_variant', editVariant, {
      describe: "Edit one email variant's subject/body; it returns to draft for re-approval.",
      confirm: true,
    }),
    toSpec('regenerate_variant', regenerateVariants, {
      describe: "Regenerate a step's A/B variants from a note; the new variants need approval.",
      confirm: true,
    }),
    toSpec('approve_campaign', approveCampaign, {
      describe: 'Approve a campaign so sending can begin (admin only).',
      confirm: true,
    }),
    toSpec('pause_campaign', pauseCampaign, {
      describe: 'Pause a running campaign.',
      confirm: true,
    }),
    toSpec('resume_campaign', resumeCampaign, {
      describe: 'Resume a paused campaign.',
      confirm: true,
    }),
    toSpec('pause_contact', setContactPaused, {
      describe: "Pause or resume one contact's enrollment by enrollment id.",
      confirm: true,
    }),
    toSpec('approve_reply_draft', approveReplyDraft, {
      describe: 'Approve and send a drafted reply to a lead by message id.',
      confirm: true,
    }),
    toSpec('book_meeting', bookSuggestedMeeting, {
      describe: 'Book the first available meeting slot for a lead by contact id.',
      confirm: true,
    }),
  ];
}
