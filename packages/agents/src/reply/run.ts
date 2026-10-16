import { audit, Contacts, Enrollments, Icps, Messages, optOut, Replies } from '@sutra/db';
import {
  type Actor,
  type Contact,
  canTransition,
  contactTransitions,
  type Id,
  type Message,
  type ReplyAnalysis,
} from '@sutra/domain';
import type { Interval } from '@sutra/mail';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { type DraftStyle, planReplyActions, type ReplyAction } from './actions.ts';
import { type ReplyDeps, replyDeps } from './deps.ts';
import { checkAvailability } from './meetings.ts';

const ANALYST: Actor = { kind: 'agent', id: 'replyAnalyst' };
/** True for a duplicate-key error from a racing insert on a unique index. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
/** When the reply hints at no date, come back in a week. */
const DEFAULT_FOLLOW_UP_DAYS = 7;

const intervalsOf = (analysis: ReplyAnalysis): Interval[] =>
  (analysis.proposedTimes ?? []).map((t) => ({ start: new Date(t.start), end: new Date(t.end) }));

/** Renders a short thread transcript (oldest first) for the analyst's context. */
const threadText = (messages: Message[]): string =>
  messages
    .map((m) => `${m.direction === 'inbound' ? 'Them' : 'Us'}: ${m.subject}\n${m.body}`)
    .join('\n\n')
    .slice(0, 4000);

function slotLine(slot: Interval, timezone: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `- ${fmt.format(slot.start)}`;
}

/** The draft body for each style; `suggestedReply` from the analyst is preferred when present. */
async function draftBody(
  style: DraftStyle,
  analysis: ReplyAnalysis,
  contact: Contact,
  workspaceId: Id,
  deps: ReplyDeps,
  now: Date,
): Promise<string> {
  const suggested = analysis.suggestedReply?.trim();
  if (style === 'offerSlots') {
    const slots = await checkAvailability({
      workspaceId,
      contactId: contact._id,
      now,
      preferred: intervalsOf(analysis),
      deps,
    });
    const timezone = contact.timezone ?? 'UTC';
    const times = slots.length
      ? slots.map((s) => slotLine(s, timezone, contact.locale)).join('\n')
      : '(no free slots found — suggest a few times)';
    const lead = suggested || 'Happy to find time. Here are a few options that work on my side:';
    return `${lead}\n\n${times}\n\nWhich works best for you?`;
  }
  if (suggested) return suggested;
  const defaults: Record<DraftStyle, string> = {
    offerSlots: '',
    answer: 'Thanks for the reply — happy to answer. [Draft your answer here.]',
    askReferral: 'Thanks for letting me know. Could you point me to the right person for this?',
    thankReferral: 'Thank you for the introduction — I appreciate it.',
  };
  return defaults[style];
}

/** Creates an outbound draft reply awaiting human approval. Idempotent per inbound message. */
async function createDraft(
  workspaceId: Id,
  inbound: Message,
  contact: Contact,
  body: string,
): Promise<void> {
  const subject = /^re:/i.test(inbound.subject) ? inbound.subject : `Re: ${inbound.subject}`;
  try {
    await Messages.create(workspaceId, {
      contactId: contact._id,
      direction: 'outbound',
      status: 'draft',
      to: contact.email,
      subject,
      body,
      ...(inbound.threadId && { threadId: inbound.threadId }),
      idempotencyKey: `reply-draft:${inbound._id}`,
    });
  } catch (e) {
    if (isDuplicateKey(e)) return; // already drafted
    throw e;
  }
}

async function stopEnrollments(workspaceId: Id, contactId: Id): Promise<void> {
  await Enrollments.col().updateMany(
    { workspaceId, contactId, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'stopped', stopReason: 'replied', updatedAt: new Date() } },
  );
}

async function pauseEnrollments(workspaceId: Id, contactId: Id, until: Date): Promise<void> {
  await Enrollments.col().updateMany(
    { workspaceId, contactId, status: 'active' },
    { $set: { status: 'paused', nextRunAt: until, updatedAt: new Date() } },
  );
}

async function setStatus(workspaceId: Id, contact: Contact, to: Contact['status']): Promise<void> {
  if (contact.status === to) return;
  if (!canTransition(contactTransitions, contact.status, to)) return;
  await Contacts.transition(workspaceId, contact._id, contact.status, to, contactTransitions);
  contact.status = to; // keep local copy in sync for later actions
}

async function createReferralContact(
  workspaceId: Id,
  analysis: ReplyAnalysis,
  from: Contact,
): Promise<void> {
  const referral = analysis.referral;
  if (!referral?.email) return;
  try {
    await Contacts.create(workspaceId, {
      companyId: from.companyId,
      name: referral.name,
      email: referral.email,
      emailConfidence: 'role',
      source: 'chat',
      locale: from.locale,
      timezone: from.timezone,
      status: 'new',
    });
  } catch (e) {
    if (isDuplicateKey(e)) return; // already a contact
    throw e;
  }
}

/** Executes one action's side effect. */
async function execute(
  action: ReplyAction,
  ctx: {
    workspaceId: Id;
    inbound: Message;
    contact: Contact;
    analysis: ReplyAnalysis;
    now: Date;
    deps: ReplyDeps;
  },
): Promise<void> {
  const { workspaceId, inbound, contact, analysis, now, deps } = ctx;
  switch (action.kind) {
    case 'stopEnrollment':
      return stopEnrollments(workspaceId, contact._id);
    case 'status':
      return setStatus(workspaceId, contact, action.status);
    case 'optOut':
      await optOut(
        workspaceId,
        { email: contact.email },
        { source: 'reply', evidence: `reply ${inbound._id}`, actor: ANALYST },
      );
      contact.status = 'suppressed';
      return;
    case 'pauseUntil': {
      const until = analysis.followUpAt
        ? new Date(analysis.followUpAt)
        : new Date(now.getTime() + DEFAULT_FOLLOW_UP_DAYS * 86_400_000);
      return pauseEnrollments(workspaceId, contact._id, until);
    }
    case 'createContactFromReferral':
      return createReferralContact(workspaceId, analysis, contact);
    case 'draftReply': {
      const body = await draftBody(action.style, analysis, contact, workspaceId, deps, now);
      return createDraft(workspaceId, inbound, contact, body);
    }
    case 'notifyHuman':
      await audit(workspaceId, ANALYST, 'reply.notify_human', {
        entity: 'message',
        entityId: inbound._id,
        data: { intent: analysis.intent },
      });
      return;
  }
}

export interface AnalyzeReplyResult {
  intent: ReplyAnalysis['intent'];
  actions: ReplyAction['kind'][];
}

/**
 * The reply analyst, end to end for one inbound message: understand the reply (LLM), store the
 * analysis with its variant attribution, then run the deterministic action map (stop/pause the
 * sequence, change status, suppress, draft a reply for approval, record a referral). Idempotent —
 * one analysis per inbound message — and fully audited. Reply drafts are never auto-sent.
 */
export async function analyzeReply(
  workspaceId: Id,
  messageId: Id,
  { now = new Date(), deps = replyDeps() }: { now?: Date; deps?: ReplyDeps } = {},
): Promise<AnalyzeReplyResult | null> {
  const inbound = await Messages.get(workspaceId, messageId);
  if (inbound?.direction !== 'inbound') return null;
  // Idempotency: one analysis per inbound message.
  if (await Replies.findOne(workspaceId, { messageId })) return null;
  const contact = await Contacts.get(workspaceId, inbound.contactId);
  if (!contact) return null;

  const [thread, icp] = await Promise.all([
    Messages.find(
      workspaceId,
      { contactId: inbound.contactId, status: { $in: ['sent', 'received', 'bounced'] } },
      { sort: { createdAt: 1 } },
    ),
    Icps.find(workspaceId, {}, { sort: { version: -1 }, limit: 1 }),
  ]);
  const icpSummary = icp[0]?.rationale ?? icp[0]?.firmographics.industries.join(', ');

  const analysis = await deps.analyzer.analyze({
    workspaceId,
    messageId,
    reply: inbound.body,
    locale: contact.locale,
    thread: threadText(thread),
    icpSummary,
  });

  // Store the analysis with its variant attribution (which variant/step earned the reply).
  try {
    await Replies.create(workspaceId, {
      messageId,
      contactId: contact._id,
      campaignId: inbound.campaignId,
      stepIndex: inbound.stepIndex,
      variantId: inbound.variantId,
      ...analysis,
      at: now,
    });
  } catch (e) {
    if (isDuplicateKey(e)) return null; // concurrent analysis
    throw e;
  }

  const actions = planReplyActions(analysis.intent);
  for (const action of actions)
    await execute(action, { workspaceId, inbound, contact, analysis, now, deps });

  await audit(workspaceId, ANALYST, 'reply.analyzed', {
    entity: 'message',
    entityId: messageId,
    data: {
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      language: analysis.language,
      variantId: inbound.variantId,
      actions: actions.map((a) => a.kind),
    },
  });

  return { intent: analysis.intent, actions: actions.map((a) => a.kind) };
}

/**
 * The `replyAnalyst` pipeline node's run (triggered by `reply.received`). `ctx.item` is the inbound
 * message id. Returns a one-line summary so the live agent graph flashes the node with its outcome.
 */
export async function runReplyAnalyst(ctx: NodeContext): Promise<NodeResult> {
  if (!ctx.item) return { summary: 'No reply to analyse' };
  const result = await analyzeReply(ctx.workspaceId, ctx.item);
  if (!result) return { summary: 'Already analysed' };
  return { summary: `${result.intent} · ${result.actions.join(', ')}` };
}
