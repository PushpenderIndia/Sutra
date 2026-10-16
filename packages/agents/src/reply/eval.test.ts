import type { ReplyIntent } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { replyEvalSet } from './fixtures.ts';
import { heuristicAnalyze } from './heuristic.ts';

/**
 * The offline eval: the deterministic multilingual analyser must classify the labelled set with high
 * accuracy. (Production uses the `replyAnalyst` LLM, measured against the same set out of band.)
 */
describe('reply intent eval set', () => {
  it('has 40 labelled replies across six languages', () => {
    expect(replyEvalSet.length).toBe(40);
    expect(new Set(replyEvalSet.map((c) => c.locale)).size).toBe(6);
  });

  it('covers a broad spread of intents', () => {
    const intents = new Set(replyEvalSet.map((c) => c.expected));
    for (const required of [
      'interested',
      'meeting_request',
      'question',
      'objection',
      'not_now',
      'not_interested',
      'unsubscribe',
      'out_of_office',
      'referral',
      'wrong_person',
    ] as ReplyIntent[])
      expect(intents).toContain(required);
  });

  it('classifies at least 90% of the set correctly', () => {
    const correct = replyEvalSet.filter(
      (c) => heuristicAnalyze(c.reply, c.locale).intent === c.expected,
    );
    const accuracy = correct.length / replyEvalSet.length;
    const misses = replyEvalSet
      .filter((c) => heuristicAnalyze(c.reply, c.locale).intent !== c.expected)
      .map(
        (c) =>
          `${c.locale}: "${c.reply}" → ${heuristicAnalyze(c.reply, c.locale).intent} (want ${c.expected})`,
      );
    expect(accuracy, `misses:\n${misses.join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('treats a removal request as unsubscribe in every language', () => {
    for (const reply of [
      'Please remove me from your list.',
      '配信停止をお願いします。',
      '请退订。',
      'Mohon berhenti berlangganan.',
      'Vui lòng hủy đăng ký.',
      'मुझे सूची से हटा दें।',
    ])
      expect(heuristicAnalyze(reply).intent).toBe('unsubscribe');
  });

  it('reads the Japanese meeting acceptance as a meeting request', () => {
    expect(heuristicAnalyze('来週火曜の午後なら大丈夫です。', 'ja').intent).toBe('meeting_request');
  });
});
