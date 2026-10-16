import type { ReplyIntent } from '@sutra/domain';
import { replyIntent } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { onIntent, planReplyActions, type ReplyAction } from './actions.ts';

const kinds = (actions: ReplyAction[]) => actions.map((a) => a.kind);

describe('deterministic action map', () => {
  it('covers every reply intent', () => {
    for (const intent of replyIntent.options) expect(onIntent[intent as ReplyIntent]).toBeDefined();
  });

  it('maps each intent to the specified actions', () => {
    expect(kinds(planReplyActions('interested'))).toEqual([
      'stopEnrollment',
      'status',
      'draftReply',
    ]);
    expect(kinds(planReplyActions('meeting_request'))).toEqual([
      'stopEnrollment',
      'status',
      'draftReply',
    ]);
    expect(kinds(planReplyActions('question'))).toEqual(['stopEnrollment', 'status', 'draftReply']);
    expect(kinds(planReplyActions('objection'))).toEqual([
      'stopEnrollment',
      'status',
      'draftReply',
    ]);
    expect(kinds(planReplyActions('not_now'))).toEqual(['pauseUntil', 'status']);
    expect(kinds(planReplyActions('out_of_office'))).toEqual(['pauseUntil']);
    expect(kinds(planReplyActions('not_interested'))).toEqual(['stopEnrollment', 'status']);
    expect(kinds(planReplyActions('unsubscribe'))).toEqual(['optOut', 'status']);
    expect(kinds(planReplyActions('wrong_person'))).toEqual(['stopEnrollment', 'draftReply']);
    expect(kinds(planReplyActions('referral'))).toEqual([
      'createContactFromReferral',
      'draftReply',
    ]);
    expect(kinds(planReplyActions('other'))).toEqual(['notifyHuman']);
  });

  it('routes positive intents to an interested status with an offer-slots draft', () => {
    for (const intent of ['interested', 'meeting_request'] as const) {
      const actions = planReplyActions(intent);
      expect(actions).toContainEqual({ kind: 'status', status: 'interested' });
      expect(actions).toContainEqual({ kind: 'draftReply', style: 'offerSlots' });
    }
  });
});
