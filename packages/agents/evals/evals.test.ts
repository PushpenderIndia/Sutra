import { newId } from '@sutra/db';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmationReply } from '../src/chat/confirm.ts';
import { runCopilot } from '../src/chat/run.ts';
import type { ChatToolSpec } from '../src/chat/tools.ts';
import { setComplianceCheck } from '../src/safety.ts';
import { completion, mockProxy, toolCall } from '../test/mock-proxy.ts';
import { copilotCases, copilotTools, READ_TOOLS } from './datasets/copilot.ts';
import { profilerCases } from './datasets/profiler.ts';
import { scorerCases } from './datasets/scorer.ts';
import { variantPairs } from './datasets/variant.ts';
import { reportPassed } from './framework.ts';
import { runEvals } from './run.ts';

const proxy = await mockProxy();

/**
 * CI runs the eval harness as part of `pnpm test` (no network). Every set must meet its target, and
 * the datasets must be the sizes the plan calls for. A metric dropping below target fails the build —
 * the PR 18 acceptance criterion "every target is met".
 */
describe('eval harness', () => {
  it('every agent set meets its targets', () => {
    for (const report of runEvals()) {
      const failing = report.metrics.filter((m) => !m.pass);
      expect(
        reportPassed(report),
        `${report.agent}: ${failing.map((m) => m.name).join(', ')}`,
      ).toBe(true);
    }
  });

  it('has the dataset sizes the plan specifies', () => {
    expect(scorerCases.length).toBe(20); // scorer: 20 companies
    expect(variantPairs.flatMap((p) => p.variants).length * 3).toBe(30); // variantWriter: 30 (3 locales)
    expect(profilerCases.length).toBe(5); // profiler + ICP: 5 websites
    expect(copilotCases.length).toBe(20); // copilot: 20 instructions
  });
});

/** Tool specs for the copilot built from the eval tool catalogue, recording what actually executes. */
function copilotSpecs() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const list: ChatToolSpec[] = Object.entries(copilotTools).map(([name, parameters]) => ({
    name,
    description: name,
    parameters,
    confirm: !READ_TOOLS.has(name as never),
    execute: async (args) => {
      calls.push({ name, args });
      return { ok: true };
    },
  }));
  return { calls, list };
}

/**
 * End-to-end routing eval against the mock proxy: for each labelled case the model is scripted to emit
 * the labelled tool call, and the harness must (read) run it, or (mutation) hold it for confirmation
 * and run it only after the user confirms — exactly the PR 16 contract, on the eval dataset.
 */
describe('copilot routing (offline, mock proxy)', () => {
  afterEach(() => setComplianceCheck(async () => ({ allowed: true })));

  it('routes a read instruction straight to its tool', async () => {
    const readCase = copilotCases.find((c) => !c.mutation);
    if (!readCase) throw new Error('no read case');
    const p = proxy;
    const { calls, list } = copilotSpecs();
    p.reply(
      { json: completion(null, { toolCalls: [toolCall('r1', readCase.tool, readCase.args)] }) },
      { json: completion('Here you go.') },
    );
    const turn = await runCopilot({
      workspaceId: newId(),
      userId: 'u',
      sessionKey: `eval-read:${newId()}`,
      input: readCase.instruction,
      state: { workspace: 'Acme' },
      specs: list,
      model: p.model('sutra-smart'),
    });
    expect(turn.confirmation).toBeUndefined();
    expect(calls.map((c) => c.name)).toEqual([readCase.tool]);
    expect(calls[0]?.args).toEqual(readCase.args);
  });

  it('holds a mutation for confirmation, then runs it on confirm', async () => {
    const mutationCase = copilotCases.find((c) => c.mutation);
    if (!mutationCase) throw new Error('no mutation case');
    const p = proxy;
    const { calls, list } = copilotSpecs();
    const workspaceId = newId();
    const sessionKey = `eval-mut:${newId()}`;
    p.reply({
      json: completion(null, { toolCalls: [toolCall('m1', mutationCase.tool, mutationCase.args)] }),
    });
    const first = await runCopilot({
      workspaceId,
      userId: 'u',
      sessionKey,
      input: mutationCase.instruction,
      state: { workspace: 'Acme' },
      specs: list,
      model: p.model('sutra-smart'),
    });
    expect(first.confirmation?.tool).toBe(mutationCase.tool);
    expect(calls).toHaveLength(0);

    p.reply({ json: completion('Done.') });
    const second = await runCopilot({
      workspaceId,
      userId: 'u',
      sessionKey,
      input: confirmationReply(first.confirmation?.callId ?? '', true),
      specs: list,
      model: p.model('sutra-smart'),
    });
    expect(second.text).toBe('Done.');
    expect(calls).toEqual([{ name: mutationCase.tool, args: mutationCase.args }]);
  });
});
