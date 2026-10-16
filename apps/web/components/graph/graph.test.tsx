// @vitest-environment happy-dom
import { MAIN_TOPOLOGY } from '@sutra/agents/topology';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutGraph } from '@/lib/graph/layout';
import { outputHref } from '@/lib/graph/links';
import { buildGraph, mergeRun, type NodeState, type RunState } from '@/lib/graph/model';
import { demoRecording, flashingAt, replayAt } from '@/lib/graph/replay';
import { renderUi } from '@/test/render';
import { AgentGraph } from './agent-graph';
import GraphCanvas from './graph-canvas';
import { NodeDetails } from './node-details';
import { GraphContext } from './parts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
afterEach(cleanup);

const rec = demoRecording();
const T0 = Date.parse(rec.startedAt);
const at = (sec: number) => replayAt(rec, sec * 1000);
const node = (nodeId: string, patch: Partial<NodeState> = {}): NodeState => ({
  nodeId,
  agent: nodeId.split(/[./]/).at(-1) ?? nodeId,
  status: 'running',
  updatedAt: '2026-10-01T09:00:00.000Z',
  tokens: 0,
  costUsd: 0,
  toolCalls: [],
  ...patch,
});

describe('buildGraph', () => {
  it('draws the planned pipeline before any run', () => {
    const g = buildGraph(MAIN_TOPOLOGY, []);
    expect(g.root?.id).toBe('orchestrator');
    expect(g.stages.map((s) => s.id)).toEqual([
      'profiler',
      'checkpoint1',
      'prospector',
      'enricher',
      'copywriter',
      'checkpoint2',
      'sender',
    ]);
    expect(g.stages.filter((s) => s.role === 'human').map((s) => s.id)).toEqual([
      'checkpoint1',
      'checkpoint2',
    ]);
    expect(g.triggers.map((s) => s.id)).toEqual(['replyAnalyst', 'optimizer']);
    expect(g.children.profiler?.map((c) => c.id)).toEqual([
      'profiler/crawler',
      'profiler/webResearch',
      'profiler/icpBuilder',
    ]);
    expect(g.children.prospector?.map((c) => c.role)).toEqual(['placeholder']);
    expect(g.stages.every((s) => s.status === 'queued')).toBe(true);
  });

  it('adds fan-out sources, recorded sub-agents and unknown stages from the live run', () => {
    const g = buildGraph(MAIN_TOPOLOGY, [
      node('prospector'),
      node('prospector.places', { parentId: 'prospector', progress: { done: 12 } }),
      node('prospector.search', { parentId: 'prospector', status: 'done' }),
      node('profiler/profileWriter', { parentId: 'profiler', agent: 'profileWriter' }),
      node('prospector.search/search_agent', { parentId: 'prospector.search' }),
      node('auditor', { parentId: 'orchestrator' }),
    ]);
    expect(g.children.prospector?.map((c) => [c.id, c.item])).toEqual([
      ['prospector.places', true],
      ['prospector.search', true],
    ]);
    expect(g.children.profiler?.at(-1)).toMatchObject({ name: 'profileWriter', role: 'child' });
    expect(g.stages.at(-1)?.id).toBe('auditor');
    expect(g.edges).toContainEqual(
      expect.objectContaining({ source: 'sender', target: 'auditor' }),
    );
    expect(outputHref(g.children.prospector?.[0] as never)).toBe('/prospects?source=places');
  });
});

describe('layoutGraph', () => {
  it('is deterministic and never moves stages as children appear', () => {
    const empty = layoutGraph(buildGraph(MAIN_TOPOLOGY, []));
    expect(layoutGraph(buildGraph(MAIN_TOPOLOGY, []))).toEqual(empty);
    const busy = layoutGraph(buildGraph(MAIN_TOPOLOGY, at(30).nodes));
    expect(layoutGraph(buildGraph(MAIN_TOPOLOGY, at(30).nodes))).toEqual(busy);
    for (const id of [
      'orchestrator',
      'profiler',
      'checkpoint1',
      'prospector',
      'sender',
      'optimizer',
    ])
      expect(busy[id]).toEqual(empty[id]);
    const xs = ['profiler', 'checkpoint1', 'prospector', 'enricher'].map((id) => busy[id]?.x ?? 0);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    // Sources hang below the prospector without overlapping.
    const sources = Object.keys(busy).filter((id) => id.startsWith('prospector.'));
    expect(sources).toHaveLength(6);
    const ys = sources.map((id) => busy[id]?.y ?? 0);
    expect(new Set(ys).size).toBe(6);
  });
});

describe('mergeRun', () => {
  const run = (nodes: NodeState[], patch: Partial<RunState> = {}): RunState => ({
    id: 'r1',
    status: 'running',
    cursor: 'c',
    full: true,
    nodes,
    ...patch,
  });

  it('merges diffs by id and drops descendants of a node reset by a re-run', () => {
    const current = run([node('profiler'), node('prospector'), node('prospector.search')]);
    const diff = run(
      [node('profiler', { status: 'done' }), node('prospector', { status: 'queued' })],
      {
        full: false,
        cursor: 'c2',
      },
    );
    const merged = mergeRun(current, diff);
    expect(merged?.cursor).toBe('c2');
    expect(merged?.nodes.map((n) => [n.nodeId, n.status])).toEqual([
      ['profiler', 'done'],
      ['prospector', 'queued'],
    ]);
    expect(mergeRun(current, run([], { id: 'r2' }))?.id).toBe('r2');
    expect(mergeRun(current, null)).toBeNull();
  });
});

describe('recorded run replay', () => {
  it('is a pure function of time', () => {
    expect(JSON.stringify(at(20))).toBe(JSON.stringify(at(20)));
    expect(at(10).nodes.find((n) => n.nodeId === 'checkpoint1')?.status).toBe('waiting_human');
    expect(at(10).status).toBe('waiting_human');
    const end = at(64);
    expect(end.status).toBe('done');
    const g = buildGraph(rec.topology, end.nodes);
    expect(g.stages.every((s) => s.status === 'done')).toBe(true);
    expect(g.children.prospector?.every((c) => c.item && (c.state?.progress?.done ?? 0) > 0)).toBe(
      true,
    );
    expect(g.triggers.map((t) => t.state?.summary)).toEqual([
      'question from Roti Bakar 88',
      'Challenger B2 queued for approval',
    ]);
    expect([...flashingAt(rec, 54_500)]).toEqual(['replyAnalyst']);
    expect(flashingAt(rec, 57_000).size).toBe(0);
  });

  it('renders identically every time', () => {
    const view = (sec: number) => {
      const { container, unmount } = renderUi(
        <AgentGraph run={at(sec)} topology={rec.topology} now={T0 + sec * 1000} />,
      );
      // React's useId differs per mount; everything else must match.
      const html = container.innerHTML.replace(/_r_\w+_/g, 'id');
      unmount();
      return html;
    };
    for (const sec of [5, 18, 30, 50]) expect(view(sec)).toBe(view(sec));
    expect(view(18)).not.toBe(view(30));
  });

  it('draws the expanded graph identically every time', () => {
    const canvas = (sec: number) => {
      const run = at(sec);
      const g = buildGraph(rec.topology, run.nodes);
      const { container, unmount } = renderUi(
        <div style={{ width: 1200, height: 400 }}>
          <GraphContext
            value={{
              nodes: run.nodes,
              children: g.children,
              now: T0 + sec * 1000,
              flashing: flashingAt(rec, sec * 1000),
              openId: null,
              setOpenId: () => {},
            }}
          >
            <GraphCanvas graph={g} />
          </GraphContext>
        </div>,
      );
      const html = container.innerHTML.replace(/_r_\w+_/g, 'id');
      const text = container.textContent;
      unmount();
      return { html, text };
    };
    const first = canvas(20);
    expect(canvas(20)).toEqual(first);
    expect(first.text).toContain('Lookalike');
    expect(first.text).toMatch(/Prospector6 sources · \d+ found/);
  });

  it('shows the running stage with live source counts and marks checkpoints', () => {
    renderUi(<AgentGraph run={at(18)} topology={rec.topology} now={T0 + 18_000} />);
    expect(screen.getByRole('button', { name: /Prospector.*6 sources · \d+ found/ })).toBeTruthy();
    cleanup();
    renderUi(<AgentGraph run={at(10)} topology={rec.topology} now={T0 + 10_000} />);
    const checkpoint = screen.getByRole('link', { name: /You.*Waiting for you/ });
    expect(checkpoint.getAttribute('href')).toBe('/business');
  });
});

describe('<NodeDetails>', () => {
  it('shows summary, duration, usage, the last tool calls and re-run for admins', async () => {
    const run = at(9.2);
    const g = buildGraph(rec.topology, run.nodes);
    const profiler = g.stages[0];
    if (!profiler) throw new Error('no profiler');
    const onRerun = vi.fn();
    renderUi(
      <GraphContext
        value={{
          nodes: run.nodes,
          children: g.children,
          now: T0 + 9_200,
          flashing: new Set(),
          onRerun,
          openId: 'profiler',
          setOpenId: () => {},
        }}
      >
        <NodeDetails node={profiler} />
      </GraphContext>,
    );
    expect(screen.getByText('Print-on-demand for café brands')).toBeTruthy();
    expect(screen.getByText('8.8s')).toBeTruthy();
    expect(screen.getByText('14K')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /View output/ }).getAttribute('href')).toBe(
      '/business',
    );
    await userEvent.click(screen.getByRole('button', { name: /Re-run from here/ }));
    expect(onRerun).toHaveBeenCalledWith('profiler');
  });
});
