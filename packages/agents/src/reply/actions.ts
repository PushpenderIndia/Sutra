import type { ContactStatus, ReplyIntent } from '@sutra/domain';

/** How a draft reply reads; the executor turns each into a drafted (never auto-sent) message. */
export type DraftStyle = 'offerSlots' | 'answer' | 'askReferral' | 'thankReferral';

/**
 * One deterministic action the executor performs for a reply. The LLM decides the intent; this data
 * table decides the consequences — nothing here is a model choice.
 */
export type ReplyAction =
  | { kind: 'stopEnrollment' }
  | { kind: 'status'; status: ContactStatus }
  | { kind: 'optOut' }
  | { kind: 'pauseUntil'; field: 'followUpAt' }
  | { kind: 'createContactFromReferral' }
  | { kind: 'draftReply'; style: DraftStyle }
  | { kind: 'notifyHuman' };

const stop: ReplyAction = { kind: 'stopEnrollment' };
const status = (s: ContactStatus): ReplyAction => ({ kind: 'status', status: s });
const draft = (style: DraftStyle): ReplyAction => ({ kind: 'draftReply', style });

/**
 * The action map (PR 14 §"Deterministic action map"): intent → ordered actions. Reply drafts always
 * need human approval before anything is sent — there is no auto-reply.
 */
export const onIntent: Record<ReplyIntent, ReplyAction[]> = {
  interested: [stop, status('interested'), draft('offerSlots')],
  meeting_request: [stop, status('interested'), draft('offerSlots')],
  question: [stop, status('interested'), draft('answer')],
  objection: [stop, status('engaged'), draft('answer')],
  not_now: [{ kind: 'pauseUntil', field: 'followUpAt' }, status('not_now')],
  out_of_office: [{ kind: 'pauseUntil', field: 'followUpAt' }],
  not_interested: [stop, status('not_interested')],
  unsubscribe: [{ kind: 'optOut' }, status('not_interested')],
  wrong_person: [stop, draft('askReferral')],
  referral: [{ kind: 'createContactFromReferral' }, draft('thankReferral')],
  other: [{ kind: 'notifyHuman' }],
};

/** The actions for an intent (pure). */
export const planReplyActions = (intent: ReplyIntent): ReplyAction[] => onIntent[intent];
