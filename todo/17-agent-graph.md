# PR 17 — Live agent graph

**Branch:** `feat/17-agent-graph` · **Depends on:** 05, 06 · **Size:** S

## Why
Make the multi-agent system **visible**. The top bar shows which agents and sub-agents are running right now, what they're doing, and what they've produced.

## Data: nothing new
The pipeline definition (`pipeline.ts`, PR 06) gives the **topology**; `pipeline_nodes` gives the **live state** (written automatically by the ADK plugin). The graph is a pure render of those two.

```ts
// GET /api/pipeline/[runId]?after=<updatedAt>  → changed nodes only
type NodeState = { nodeId; parentId?; agent; status: 'queued'|'running'|'done'|'failed'|'waiting_human'|'skipped';
                   summary?: string; startedAt?; endedAt?; tokens?; costUsd?; toolCalls?: { name; at }[] };
```
The client polls every 1.5s while the run is active and every 10s when idle (free-tier friendly; no change streams needed).

## Rendering (React Flow)
- **Collapsed bar (56px):** the main stages as pills left to right: `Profiler → ✋ You → Prospector → Enricher → Copywriter → ✋ You → Sender → Reply Analyst · Optimizer`. Running stages pulse in the accent colour, with a one-line summary ("Prospector: 3 sources · 148 companies").
- **Expanded (click or hover, ~160px, or a full-screen dialog):** the graph with **sub-agents** as child nodes:
  - Profiler → Crawler · Web research · ICP builder
  - Prospector → one node **per source** (Search · Lookalike · Places · Registry · Apollo · Hunter), each with a live result count
  - Enricher → Contact finder · Researcher · Scorer (progress bar: 87/148)
  - Copywriter → Sequence planner · Variant writer · Quality gate
  - Sender → Compliance · Scheduler · Gmail
- **Human nodes** (✋) show "Waiting for you"; clicking jumps to the checkpoint
- **Edges animate** while data flows (dashed, moving), and settle when done
- **Node click** opens a popover: summary, duration, tokens and cost, the last 5 tool calls, a "view output" link (e.g. filters Prospects to that source's results), and a "re-run from here" button (admin)
- Layout via `dagre` (left to right), fixed per pipeline definition, so it never jumps around

## Event-driven agents
`replyAnalyst` and `optimizer` aren't part of the linear run. They show as side nodes that flash briefly whenever they fire ("Reply Analyst: meeting_request from Kopi Kenangan").

## Tasks
- [ ] Pipeline state endpoint (diff since timestamp)
- [ ] `<AgentGraphBar>` collapsed + expanded views with React Flow + dagre
- [ ] Node popover with re-run
- [ ] Animations (pulse, edge flow, completion) respecting `prefers-reduced-motion`
- [ ] A Storybook-style fixture page that replays a recorded run (for demos and for testing visuals)

## Acceptance criteria
- Starting onboarding with a URL shows the Profiler and its sub-agents running within 1s
- Every source sub-agent shows a live result count
- Human checkpoints are clearly marked and clickable
- Replaying a recorded run renders identically every time
