import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  campaignStatus,
  campaignTransitions,
  canTransition,
  contactStatus,
  contactTransitions,
  enrollmentStatus,
  enrollmentTransitions,
  messageStatus,
  messageTransitions,
  type TransitionTable,
  variantStatus,
  variantTransitions,
} from './status.ts';

const machines: [string, z.ZodEnum, TransitionTable<string>][] = [
  ['campaign', campaignStatus, campaignTransitions],
  ['variant', variantStatus, variantTransitions],
  ['enrollment', enrollmentStatus, enrollmentTransitions],
  ['message', messageStatus, messageTransitions],
  ['contact', contactStatus, contactTransitions],
];

describe.each(machines)('%s transitions', (_, status, table) => {
  it('covers every status and only targets real statuses, never itself', () => {
    expect(Object.keys(table).sort()).toEqual([...status.options].sort());
    for (const [from, targets] of Object.entries(table)) {
      for (const to of targets) {
        expect(status.options).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });
});

describe('canTransition', () => {
  it('follows the table', () => {
    expect(canTransition(variantTransitions, 'pending_approval', 'approved')).toBe(true);
    expect(canTransition(variantTransitions, 'draft', 'active')).toBe(false);
    expect(canTransition(variantTransitions, 'retired', 'active')).toBe(false);
    expect(canTransition(messageTransitions, 'queued', 'sent')).toBe(true);
  });
});
