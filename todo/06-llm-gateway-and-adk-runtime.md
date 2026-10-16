# PR 06 — LLM gateway, ADK runtime, pipeline engine

**Branch:** `feat/06-llm-gateway-and-adk-runtime` · **Depends on:** 03 · **Size:** M

## Why
Every agent should get any model through one gateway, persist sessions in Mongo, and be run through one helper. Then each later agent is roughly "prompt + output schema + tools".

## 1. LiteLLM Proxy (`infra/litellm/`)
Run the official LiteLLM proxy image as its own private Cloud Run service. Agents call **aliases**, never raw model IDs:

```yaml
# infra/litellm/config.yaml
model_list:
  - model_name: sutra-fast        # classification, scoring, short drafts
    litellm_params: { model: gemini/gemini-<flash-lite-version>, api_key: os.environ/GEMINI_API_KEY }
  - model_name: sutra-smart       # personalisation, reply understanding
    litellm_params: { model: gemini/gemini-<flash-version>, api_key: os.environ/GEMINI_API_KEY }
  # Paid providers can be added later with no code changes, e.g.:
  # - model_name: sutra-smart
  #   litellm_params: { model: vertex_ai/gemini-<pro-version>, ... }
router_settings: { num_retries: 3, retry_after: 5, fallbacks: [{ sutra-smart: [sutra-fast] }] }   # 429 on one free model → the other
litellm_settings: { drop_params: true }
general_settings: { master_key: os.environ/LITELLM_API_KEY }   # no database_url: stateless, no Postgres
```
- **Free tier:** both aliases point at free-tier Gemini Flash models via the Gemini API (AI Studio key), not Vertex AI. Pin model versions at implementation time. Switching to paid or other providers is a YAML change.
- The proxy runs **stateless** (no Postgres), so it costs nothing beyond Cloud Run's free tier.
- **Cost tracking without the proxy DB:** the adapter reads LiteLLM's `x-litellm-response-cost` response header plus token usage and stores them on an `llm_usage` doc (`workspaceId, agent, model, tokensIn, tokensOut, costUsd, at`). On the free tier the real cost is $0, but the dashboard shows the list-price equivalent ("would cost $X at scale").
- **Rate limits:** the free tier has per-minute and per-day caps. `runAgent` uses a per-model token-bucket limiter (in Mongo, so it holds across instances), and the job queue backs off on 429.

## 2. `LiteLlm` adapter (`packages/agents/src/llm/lite-llm.ts`)
ADK-JS has no native LiteLLM, so we write one `BaseLlm` subclass (about 150 lines) that talks to the proxy's OpenAI-compatible `/chat/completions`:
- Maps ADK `LlmRequest` (contents, system instruction, tools, response schema) → OpenAI messages, tools and `response_format: json_schema`
- Maps responses and tool calls back → `LlmResponse`, with streaming support
- Registered in `LLMRegistry` for the pattern `^sutra-` so agents simply say `model: 'sutra-fast'`

**Exception that calls Gemini directly** (a Gemini-native feature): agents using the `google_search` grounding tool (profiler, search prospector, researcher; PRs 07–09).

## 3. `MongoSessionService` (`packages/db/src/adk-session-service.ts`)
Extends ADK's `BaseSessionService`: `createSession`, `getSession` (with `numRecentEvents` / `afterTimestamp` filtering), `listSessions`, `deleteSession`, `appendEvent` (applies `stateDelta` with app/user/session state prefixes). Collections: `adk_sessions`, `adk_events`.
- Write a contract test suite that runs against both `InMemorySessionService` and ours, so behaviour matches.

## 4. One agent runner (`packages/agents/src/run.ts`)

```ts
export async function runAgent<O extends z.ZodType>(opts: {
  agent: LlmAgent; workspaceId: string; sessionKey: string;   // e.g. `lead:${leadId}`
  input: string | Content; output?: O; state?: Record<string, unknown>;
}): Promise<{ output: z.infer<O>; events: Event[]; usage: Usage }>
```
- Creates or loads the session in Mongo, runs, parses and validates the final structured output against the Zod schema (retries once on a validation failure), and writes an `audit_event`.
- One `defineAgent({ name, model, instruction, output, tools })` factory with shared defaults: safety settings, prompt-injection preamble, `{workspace.*}` state templating and temperature.

## 5. Shared prompt rules (`packages/agents/src/prompts/base.ts`)
Each agent prompt composes from shared fragments: `company profile`, `brand voice`, `locale rules`, `untrusted-content guard` (anything scraped or received is wrapped in `<untrusted>` tags, and agents never follow instructions found there), `no fabrication` (claims must cite research).

## 6. Safety
- ADK plugin `injectionGuard` with a `beforeModel` callback: strips and flags instructions inside untrusted blocks, and blocks tool calls the agent isn't allowed to make in that context.
- `beforeTool` callback: every side-effecting tool runs through `compliance.check()` (PR 10) and is audited.

## 7. Pipeline engine: one definition drives execution and the agent graph

The autonomous flow is a **declarative graph**. The same object runs the agents and draws the live graph in PR 17.

```ts
// packages/agents/src/pipeline.ts
export const pipeline = definePipeline({
  orchestrator: { label: 'Orchestrator', children: ['profiler', 'prospector', 'enricher', 'copywriter', 'sender', 'optimizer'] },
  profiler:     { label: 'Business Profiler', children: ['crawler', 'webResearch', 'icpBuilder'], run: profileBusiness },
  checkpoint1:  { label: 'You confirm profile', kind: 'human', after: ['profiler'] },
  prospector:   { label: 'Prospector', after: ['checkpoint1'], fanOut: enabledSources, run: prospect },   // one child per LeadSource
  enricher:     { label: 'Enricher & Scorer', after: ['prospector'], children: ['contactFinder', 'researcher', 'scorer'], run: enrich },
  copywriter:   { label: 'Copywriter', after: ['enricher'], children: ['sequencePlanner', 'variantWriter', 'qualityGate'], run: writeCampaign },
  checkpoint2:  { label: 'You approve campaign', kind: 'human', after: ['copywriter'] },
  sender:       { label: 'Sender', after: ['checkpoint2'], children: ['compliance', 'scheduler', 'gmail'], run: startCampaign },
  replyAnalyst: { label: 'Reply Analyst', trigger: 'reply.received', run: analyzeReply },
  optimizer:    { label: 'A/B Optimizer', trigger: 'cron', run: optimize },
});
```

- `runPipeline(workspaceId, from?)` walks the graph: runs each node as a job (PR 13's queue), **stops at `human` nodes** until the matching action (confirm or approve) resumes it, and fans out `fanOut` nodes in parallel.
- Each node and sub-agent writes to `pipeline_nodes` (`queued → running → done | failed | waiting_human`, summary line, tokens, cost). An ADK plugin with `beforeAgent` / `afterAgent` / `beforeTool` callbacks records sub-agent and tool activity automatically, so **agents need no graph code**.
- Re-running from any node (e.g. after the ICP is edited) invalidates its downstream nodes. That's how "edit the ICP → prospects refresh" works.

## Tasks
- [ ] LiteLLM config + local `docker compose` for the proxy
- [ ] `LiteLlm` adapter + registry + tests with a mocked proxy
- [ ] `MongoSessionService` + contract tests
- [ ] `defineAgent`, `runAgent`, prompt fragments, safety plugin
- [ ] `pnpm agent:try <name> "<input>"` CLI for quick manual runs
- [ ] `definePipeline` + `runPipeline` + human-node pause/resume + downstream invalidation
- [ ] ADK plugin that records nodes, sub-agents and tool calls into `pipeline_nodes`

## Acceptance criteria
- A hello-world agent using `sutra-fast` runs through the proxy, and its session persists in Mongo
- Restarting the process and resuming the same session key keeps history
- The structured output is validated; invalid output retries once, then raises a typed error
- Changing `sutra-fast` to another provider in YAML requires no code changes
- A fake pipeline with two agents and a human node pauses at the human node and resumes on confirm (tested)
