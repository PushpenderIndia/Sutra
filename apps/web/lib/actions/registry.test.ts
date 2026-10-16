import { confirmationReply, runCopilot } from '@sutra/agents';
import { Campaigns, Companies, Icps, type Input } from '@sutra/db';
import type { Id, icpDoc } from '@sutra/domain';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '@/actions/workspace';
import type { Context } from '@/lib/action';
import { auth } from '@/lib/auth';
import { copilotState } from '@/lib/chat';
import { completion, mockLlm, toolCall } from '@/test/llm-proxy';
import { as, signIn, signUp } from '@/test/request';
import { chatToolSpecs } from './registry';

vi.mock('@/lib/profiler', () => ({ startProfiler: vi.fn(async () => {}) }));

const proxy = await mockLlm();

const ICP: Input<typeof icpDoc> = {
  status: 'draft',
  version: 1,
  firmographics: {
    industries: ['Banking'],
    sizes: ['51-200'],
    countries: ['SG'],
    keywords: ['ops'],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Ops',
      altTitles: [],
      seniority: 'director',
      pains: ['manual work'],
      goals: ['speed'],
      objections: [],
    },
  ],
  buyingSignals: ['hiring'],
  disqualifiers: ['tiny'],
  rationale: 'Mid-market ops teams.',
};

/** An owner with a workspace and a draft ICP, ready to be edited from chat. */
async function ownerWithIcp(email: string) {
  const owner = await signUp(email);
  as(owner.headers);
  await expect(createWorkspace({ website: 'flowbase.io', timezone: 'UTC' })).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  const session = await auth.api.getSession({ headers: owner.headers });
  const workspaceId = session?.session.activeOrganizationId as Id;
  await Icps.create(workspaceId, ICP);
  return { ...owner, workspaceId };
}

describe('chat copilot — actions as tools', () => {
  it('edits the ICP from chat with the same result as the Business tab, only after confirming', async () => {
    const { workspaceId, user, headers } = await ownerWithIcp('chat-owner@example.com');
    as(headers);
    const sessionKey = `copilot:${user.id}`;
    const patch = { disqualifiers: ['fewer than 10 staff', 'no budget'] };

    // Turn 1: the model asks to edit the ICP — it must not change anything yet.
    proxy.reply(completion(null, [toolCall('u1', 'update_icp', patch)]));
    const first = await runCopilot({
      workspaceId,
      userId: user.id,
      sessionKey,
      input: 'We no longer sell to tiny companies — require at least 10 staff and a budget.',
      specs: chatToolSpecs(),
      state: { workspace: 'Flowbase' },
      model: proxy.model(),
    });
    expect(first.confirmation?.tool).toBe('update_icp');
    expect(await Icps.count(workspaceId, {})).toBe(1); // unchanged before confirmation

    // Turn 2: the user confirms → the same saveIcp action runs → a new ICP version.
    proxy.reply(completion('Updated the ICP.'));
    const second = await runCopilot({
      workspaceId,
      userId: user.id,
      sessionKey,
      input: confirmationReply(first.confirmation?.callId ?? '', true),
      specs: chatToolSpecs(),
      model: proxy.model(),
    });
    expect(second.text).toBe('Updated the ICP.');

    const [latest] = await Icps.find(workspaceId, {}, { sort: { version: -1 }, limit: 1 });
    expect(latest?.version).toBe(2);
    expect(latest?.status).toBe('draft');
    expect(latest?.disqualifiers).toEqual(patch.disqualifiers);
    expect(latest?.firmographics.industries).toEqual(['Banking']); // untouched fields carry over
  });

  it('enforces the same role check as the UI: a member cannot approve a campaign via chat', async () => {
    const owner = await ownerWithIcp('role-owner@example.com');
    const member = await signUp('role-member@example.com');
    await auth.api.addMember({
      body: { userId: member.user.id, organizationId: owner.workspaceId, role: 'member' },
    });
    const campaign = await Campaigns.create(owner.workspaceId, {
      name: 'C',
      icpVersion: 1,
      steps: [{ delayDays: 0, variants: [] }],
      status: 'pending_approval',
    });

    as(await signIn('role-member@example.com'));
    const results: { tool: string; result: unknown }[] = [];
    proxy.reply(
      completion(null, [toolCall('a1', 'approve_campaign', { campaignId: campaign._id })]),
    );
    const first = await runCopilot({
      workspaceId: owner.workspaceId,
      userId: member.user.id,
      sessionKey: `copilot:${member.user.id}`,
      input: 'Approve the campaign',
      specs: chatToolSpecs(),
      state: { workspace: 'Flowbase' },
      model: proxy.model(),
    });
    expect(first.confirmation?.tool).toBe('approve_campaign');

    proxy.reply(completion('I could not approve it.'));
    await runCopilot({
      workspaceId: owner.workspaceId,
      userId: member.user.id,
      sessionKey: `copilot:${member.user.id}`,
      input: confirmationReply(first.confirmation?.callId ?? '', true),
      specs: chatToolSpecs(),
      model: proxy.model(),
      onToolResult: (tool, result) => results.push({ tool, result }),
    });

    // The action ran under the member's session and was refused by its own role guard.
    const forbidden = results.find((r) => r.tool === 'approve_campaign');
    expect((forbidden?.result as { code?: string })?.code).toBe('FORBIDDEN');
    expect((await Campaigns.get(owner.workspaceId, campaign._id))?.status).toBe('pending_approval');
  });

  it('puts the selected rows in context so the copilot can act on "this" without a named id', async () => {
    const { workspaceId } = await ownerWithIcp('ctx-owner@example.com');
    const company = await Companies.create(workspaceId, {
      name: 'Kopi Kenangan',
      normalizedName: 'kopi kenangan',
      country: 'ID',
      sources: [{ source: 'search', ref: 'q', at: new Date() }],
      score: 88,
      fit: 'strong',
      scoreReasons: [{ text: 'Expanding fast', weight: 0.4, evidence: 'Opened 50 outlets' }],
    });

    const ctx = { workspaceId } as unknown as Context;
    const state = await copilotState(ctx, 'Flowbase', {
      tab: 'prospects',
      selection: [company._id],
    });
    expect(state.workspace).toBe('Flowbase');
    expect(state.tab).toBe('prospects');
    expect(state.selection).toContain('Kopi Kenangan');
    expect(state.selection).toContain(company._id);
  });
});
