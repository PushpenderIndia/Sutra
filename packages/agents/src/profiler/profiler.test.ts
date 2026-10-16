import {
  BusinessProfiles,
  Icps,
  newId,
  PipelineNodes,
  PipelineRuns,
  WorkspaceSettings,
} from '@sutra/db';
import { businessProfile, type Id, icp } from '@sutra/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { resumePipeline, runPipeline } from '../pipeline/engine.ts';
import { mainPipeline } from '../pipeline.ts';
import { fakeCrawler } from './crawler.ts';
import { setProfilerDeps } from './deps.ts';
import { fixtureResearch, profilerFixtures } from './fixtures.ts';
import { fakeWebResearcher } from './research.ts';

const proxy = await mockProxy();

const PROFILE = {
  name: 'Flowbase',
  website: 'https://flowbase.io',
  oneLiner: 'No-code workflow automation for finance and operations teams.',
  offerings: [{ name: 'Workflow builder', description: 'Drag-and-drop automation.' }],
  proofPoints: [{ text: '400+ companies', sourceUrl: 'https://flowbase.io/about' }],
  customers: [{ name: 'Northstar Bank', sourceUrl: 'https://flowbase.io/customers' }],
  geographies: ['SG', 'AU'],
  differentiators: ['SOC 2 built in'],
  competitors: [{ name: 'Zapier' }],
  toneOfVoice: 'Plain, practical and friendly.',
  sources: ['https://flowbase.io', 'https://flowbase.io/about'],
};

const ICP = {
  firmographics: {
    industries: ['Banking', 'Logistics'],
    sizes: ['51-200', '201-1000'],
    countries: ['SG', 'AU'],
    keywords: ['operations', 'approvals'],
    technologies: ['Spreadsheets'],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: ['Ops Lead'],
      seniority: 'director',
      pains: ['Manual data entry'],
      goals: ['Faster approvals'],
      objections: ['Change management'],
    },
  ],
  buyingSignals: ['hiring ops managers'],
  disqualifiers: ['fewer than 10 staff'],
  rationale: 'Customers like Northstar Bank are mid-market ops teams in SG and AU.',
};

/** Writer agents pointed at the mock proxy, so the profiler run uses no real LLM. */
const profileWriter = defineAgent({
  name: 'profileWriter',
  model: proxy.model('sutra-smart'),
  instruction: 'Write the profile.',
  output: businessProfile,
});
const icpBuilder = defineAgent({
  name: 'icpBuilder',
  model: proxy.model('sutra-smart'),
  instruction: 'Build the ICP.',
  output: icp,
});

async function seedWorkspace(website: string): Promise<Id> {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    website,
    senderName: 'Mei',
    homeCountry: 'SG',
    timezone: 'Asia/Singapore',
    businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });
  return ws;
}

const nodeMap = async (ws: Id, runId: Id) =>
  Object.fromEntries((await PipelineNodes.find(ws, { runId })).map((n) => [n.nodeId, n]));

describe('profiler pipeline (checkpoint 1)', () => {
  afterEach(() => setProfilerDeps({}));

  it('crawls, researches, writes the profile and ICP, then pauses for confirmation', async () => {
    setProfilerDeps({
      crawler: fakeCrawler(profilerFixtures),
      researcher: fakeWebResearcher(fixtureResearch),
      profileWriter,
      icpBuilder,
    });
    proxy.reply(
      { json: completion(JSON.stringify(PROFILE)) },
      { json: completion(JSON.stringify(ICP)) },
    );

    const ws = await seedWorkspace('https://flowbase.io');
    const runId = await runPipeline(mainPipeline, ws);

    // The run stops at the human checkpoint; nothing downstream has started.
    expect((await PipelineRuns.get(ws, runId))?.status).toBe('waiting_human');
    const n = await nodeMap(ws, runId);
    expect(n.orchestrator?.status).toBe('done');
    expect(n.profiler).toMatchObject({ status: 'done', summary: 'Flowbase' });
    expect(n.checkpoint1?.status).toBe('waiting_human');
    expect(n['profiler/crawler']?.status).toBe('done');
    expect(n['profiler/webResearch']?.status).toBe('done');
    expect(n['profiler/profileWriter']).toMatchObject({ status: 'done', parentId: 'profiler' });
    expect(n['profiler/icpBuilder']?.status).toBe('done');

    // The profile and ICP were saved as draft version 1 (progressive saves fill the Business tab).
    const [profile] = await BusinessProfiles.find(ws, {});
    expect(profile).toMatchObject({ name: 'Flowbase', status: 'draft', version: 1 });
    expect(profile?.customers[0]?.name).toBe('Northstar Bank');
    const [icpDoc] = await Icps.find(ws, {});
    expect(icpDoc).toMatchObject({ status: 'draft', version: 1 });
    expect(icpDoc?.personas[0]?.title).toBe('Head of Operations');

    // Confirming resumes the pipeline, which now runs through to the second human checkpoint
    // (approve campaign) and pauses there.
    await resumePipeline(mainPipeline, ws, 'checkpoint1');
    expect((await PipelineRuns.get(ws, runId))?.status).toBe('waiting_human');
    expect((await nodeMap(ws, runId)).checkpoint2?.status).toBe('waiting_human');

    // Approving (checkpoint 2) runs the sender node and completes the run.
    await resumePipeline(mainPipeline, ws, 'checkpoint2');
    expect((await PipelineRuns.get(ws, runId))?.status).toBe('done');
  });

  it('fails the profiler node when no website is configured', async () => {
    setProfilerDeps({ profileWriter, icpBuilder });
    const ws = newId();
    await WorkspaceSettings.create(ws, {
      senderName: 'Mei',
      homeCountry: 'SG',
      timezone: 'Asia/Singapore',
      businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
      warmup: {},
    });
    const runId = await runPipeline(mainPipeline, ws);
    expect((await PipelineRuns.get(ws, runId))?.status).toBe('failed');
    const n = await nodeMap(ws, runId);
    expect(n.profiler).toMatchObject({ status: 'failed' });
    expect(n.profiler?.error).toMatch(/website/i);
  });
});
