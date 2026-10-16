import { MAIN_TOPOLOGY, type Topology } from '@sutra/agents/topology';
import type { PipelineRunStatus } from '@sutra/domain';
import type { NodeState, RunState } from './model';

type NodePatch = Partial<Omit<NodeState, 'nodeId' | 'toolCalls'>>;

/** One recorded change: a node patch (`tool` appends a call) or a run status, `at` ms in. */
export type Frame =
  | { at: number; nodeId: string; patch: NodePatch; tool?: string }
  | { at: number; run: PipelineRunStatus };

export type Recording = {
  topology: Topology;
  startedAt: string;
  duration: number;
  frames: Frame[];
};

/** The run as it was `t` ms in: a pure fold of the frames, so a replay is identical every time. */
export function replayAt(rec: Recording, t: number): RunState {
  const t0 = Date.parse(rec.startedAt);
  const stamp = (at: number) => new Date(t0 + at).toISOString();
  const nodes = new Map<string, NodeState>();
  let status: PipelineRunStatus = 'running';
  let last = 0;
  for (const f of rec.frames) {
    if (f.at > t) break;
    last = f.at;
    if ('run' in f) {
      status = f.run;
      continue;
    }
    const prev = nodes.get(f.nodeId) ?? {
      nodeId: f.nodeId,
      agent: f.nodeId.split(/[./]/).at(-1) ?? f.nodeId,
      status: 'queued',
      updatedAt: stamp(f.at),
      tokens: 0,
      costUsd: 0,
      toolCalls: [],
    };
    // Like the engine: starting (or re-firing a trigger) resets timing and tool calls.
    const started = f.patch.status === 'running';
    const ended = f.patch.status && ['done', 'failed', 'skipped'].includes(f.patch.status);
    const calls = started ? [] : prev.toolCalls;
    nodes.set(f.nodeId, {
      ...prev,
      ...f.patch,
      updatedAt: stamp(f.at),
      ...(started && { startedAt: stamp(f.at), endedAt: undefined, toolCalls: calls }),
      ...(ended && { endedAt: stamp(f.at) }),
      ...(f.tool && { toolCalls: [...calls, { name: f.tool, at: stamp(f.at) }].slice(-5) }),
    });
  }
  return {
    id: 'replay',
    status,
    cursor: stamp(last),
    full: true,
    nodes: [...nodes.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
  };
}

/** Builds frames from seconds into the run; every helper returns the builder for chaining. */
function timeline() {
  const frames: Frame[] = [];
  const node = (at: number, nodeId: string, patch: NodePatch = {}, tool?: string) => {
    frames.push({ at: Math.round(at * 1000), nodeId, patch, ...(tool && { tool }) });
    return b;
  };
  const b = {
    run: (at: number, run: PipelineRunStatus) => {
      frames.push({ at: Math.round(at * 1000), run });
      return b;
    },
    start: (at: number, id: string) =>
      node(at, id, {
        status: 'running',
        ...(/[./]/.test(id) && { parentId: id.split(/[./]/)[0] }),
      }),
    tool: (at: number, id: string, tool: string) => node(at, id, {}, tool),
    progress: (at: number, id: string, done: number, total?: number) =>
      node(at, id, { progress: total === undefined ? { done } : { done, total } }),
    usage: (at: number, id: string, tokens: number, costUsd: number) =>
      node(at, id, { tokens, costUsd }),
    wait: (at: number, id: string) => node(at, id, { status: 'waiting_human' }),
    done: (at: number, id: string, summary?: string) =>
      node(at, id, { status: 'done', ...(summary && { summary }) }),
    /** Counts `done` up to `to` over `[start, end]` seconds in `steps` frames. */
    countUp: (
      start: number,
      end: number,
      id: string,
      to: number,
      { total, steps = 8 }: { total?: number; steps?: number } = {},
    ) => {
      for (let i = 1; i <= steps; i++)
        b.progress(start + ((end - start) * i) / steps, id, Math.round((to * i) / steps), total);
      return b;
    },
    frames: () => frames.toSorted((x, y) => x.at - y.at),
  };
  return b;
}

const SOURCES = [
  ['search', 41, 22],
  ['lookalike', 33, 19],
  ['places', 38, 23],
  ['registry', 17, 18],
  ['apollo', 12, 21],
  ['hunter', 7, 17],
] as const;

/**
 * A recorded onboarding run of the full planned pipeline (PixelPress, a print-on-demand shop
 * for café brands): profiling, both checkpoints, six prospecting sources, enrichment, copy,
 * sending, and the event-driven reply analyst and optimizer firing. 64 seconds at 1×.
 */
export function demoRecording(): Recording {
  const b = timeline();
  b.run(0, 'running').start(0, 'orchestrator').done(0.2, 'orchestrator', 'Planning 7 stages');

  b.start(0.3, 'profiler').start(0.4, 'profiler/crawler');
  for (const [i, page] of ['/', '/about', '/products', '/customers', '/pricing'].entries())
    b.tool(0.6 + i * 0.5, 'profiler/crawler', `fetch_page ${page}`);
  b.done(3.4, 'profiler/crawler', '14 pages · 3 customer logos');
  b.start(1.2, 'profiler/webResearch')
    .tool(1.6, 'profiler/webResearch', 'google_search')
    .tool(3.1, 'profiler/webResearch', 'google_search')
    .tool(4.4, 'profiler/webResearch', 'google_search')
    .usage(5.6, 'profiler/webResearch', 8_420, 0.0021)
    .done(5.8, 'profiler/webResearch', '9 facts, each with a source');
  b.start(6, 'profiler/icpBuilder')
    .usage(8.6, 'profiler/icpBuilder', 5_310, 0.0034)
    .done(8.8, 'profiler/icpBuilder', '4 industries · 2 personas');
  b.usage(9, 'profiler', 13_730, 0.0055).done(9.1, 'profiler', 'Print-on-demand for café brands');

  b.wait(9.3, 'checkpoint1').run(9.3, 'waiting_human');
  b.done(13, 'checkpoint1', 'Confirmed by you').run(13, 'running');

  b.start(13.2, 'prospector');
  SOURCES.forEach(([source, found, secs], i) => {
    const id = `prospector.${source}`;
    const start = 13.4 + i * 0.25;
    b.start(start, id).tool(start + 0.3, id, `${source}_query`);
    b.countUp(start + 0.6, start + secs * 0.45, id, found, { steps: 6 });
    b.tool(start + secs * 0.25, id, `${source}_query`);
    b.done(start + secs * 0.45 + 0.2, id, `${found} companies`);
  });
  b.usage(24.4, 'prospector', 21_900, 0.0062).done(24.5, 'prospector', '6 sources · 148 companies');

  b.start(24.7, 'enricher').progress(24.7, 'enricher', 0, 148);
  b.start(24.9, 'enricher/contactFinder').tool(25.2, 'enricher/contactFinder', 'hunter_domain');
  b.start(25.4, 'enricher/researcher').tool(25.8, 'enricher/researcher', 'google_search');
  b.start(26, 'enricher/scorer');
  b.countUp(25, 35.5, 'enricher', 148, { total: 148, steps: 12 });
  b.tool(29.5, 'enricher/researcher', 'google_search').tool(
    33,
    'enricher/contactFinder',
    'verify_email',
  );
  b.done(35.6, 'enricher/contactFinder', '296 contacts · 271 verified')
    .done(35.7, 'enricher/researcher', '148 company briefs')
    .done(35.8, 'enricher/scorer', '41 strong · 63 medium')
    .usage(35.9, 'enricher', 64_200, 0.0188)
    .done(36, 'enricher', '148 enriched · 41 strong fit');

  b.start(36.2, 'copywriter').start(36.3, 'copywriter/sequencePlanner');
  b.done(38.4, 'copywriter/sequencePlanner', '3 steps over 9 days');
  b.start(38.5, 'copywriter/variantWriter')
    .tool(39.2, 'copywriter/variantWriter', 'cite_research')
    .tool(40.6, 'copywriter/variantWriter', 'cite_research')
    .done(42, 'copywriter/variantWriter', '6 variants');
  b.start(42.1, 'copywriter/qualityGate').tool(42.6, 'copywriter/qualityGate', 'spam_check');
  b.done(43.6, 'copywriter/qualityGate', '6 passed · 1 rewritten');
  b.usage(43.7, 'copywriter', 18_450, 0.0071).done(43.8, 'copywriter', '3 steps · 6 A/B variants');

  b.wait(44, 'checkpoint2').run(44, 'waiting_human');
  b.done(48, 'checkpoint2', 'Approved by you').run(48, 'running');

  b.start(48.2, 'sender').start(48.3, 'sender/compliance');
  b.tool(48.6, 'sender/compliance', 'compliance_check').done(
    49.6,
    'sender/compliance',
    '148 checked · 3 blocked',
  );
  b.start(49.7, 'sender/scheduler').done(50.6, 'sender/scheduler', '145 queued in 4 time zones');
  b.start(50.7, 'sender/gmail').progress(50.7, 'sender', 0, 40);
  b.countUp(51, 57, 'sender', 40, { total: 40, steps: 10 });
  for (const at of [51.2, 53.4, 55.6]) b.tool(at, 'sender/gmail', 'gmail_send');
  b.done(57.2, 'sender/gmail', '40 sent · warm-up day 1')
    .done(57.4, 'sender', 'Day 1: 40 of 145 sent')
    .run(57.5, 'done');

  b.start(53, 'replyAnalyst').tool(53.3, 'replyAnalyst', 'classify_reply');
  b.done(54, 'replyAnalyst', 'meeting_request from Kopi Kenangan');
  b.start(59, 'replyAnalyst').tool(59.3, 'replyAnalyst', 'classify_reply');
  b.done(60, 'replyAnalyst', 'question from Roti Bakar 88');
  b.start(61, 'optimizer').tool(61.4, 'optimizer', 'variant_stats');
  b.done(62.2, 'optimizer', 'Challenger B2 queued for approval');

  return {
    topology: MAIN_TOPOLOGY,
    startedAt: '2026-10-01T09:00:00.000Z',
    duration: 64_000,
    frames: b.frames(),
  };
}

/** How long an event-driven node lights up after it fires. */
export const FLASH_MS = 2_400;

/** Event-driven nodes that fired within `FLASH_MS` before `t`. */
export function flashingAt(rec: Recording, t: number): ReadonlySet<string> {
  const triggers = new Set(Object.keys(rec.topology).filter((id) => rec.topology[id]?.trigger));
  return new Set(
    rec.frames.flatMap((f) =>
      'nodeId' in f && triggers.has(f.nodeId) && f.at <= t && t - f.at < FLASH_MS ? [f.nodeId] : [],
    ),
  );
}
