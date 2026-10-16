# PR 18 — Observability, evals, hardening

**Branch:** `feat/18-observability-evals-hardening` · **Depends on:** 14 · **Size:** M

## Why
Prove it works with numbers, see inside every agent run, and close the remaining security gaps before demo day.

## Observability
- **OpenTelemetry**: ADK-JS has built-in telemetry; export traces to **Cloud Trace** and structured `pino` logs to **Cloud Logging** (both free at this volume)
- One trace per job, spanning the agent run → LLM calls → tool calls → Gmail send
- Correlation IDs on every span and log line: `workspaceId`, `runId`, `nodeId`, `contactId`, `messageId`
- The agent graph popover (PR 17) links to the node's trace

## Evals (`packages/agents/evals/`)
- One runner: `pnpm eval [agent]` loads `*.eval.json` cases → runs the agent → scores with:
  - **exact** checks (fit, intent, schema validity, grounding)
  - an **LLM judge** (`sutra-smart`) with rubrics
- Sets:
  | Agent | Cases | Metric |
  |---|---|---|
  | profiler + ICP | 5 websites | Rubric: accurate offerings, sensible ICP, grounded proof points |
  | scorer | 20 companies | `fit` accuracy |
  | variantWriter | 30 (3 locales) | Rubric: personalised, grounded, correct register, one-dimension difference, under 150 words |
  | replyAnalyst | 40 replies, 6 languages | Intent accuracy ≥ 90% |
  | copilot | 20 instructions | Correct tool + arguments |
  | bandit | simulator | Convergence ≥ 70% within 300 sends |
- CI runs evals on PRs that touch `packages/agents` and fails if a metric drops more than 5 points
- Results go into `evals/report.md`, used in the pitch

## Security hardening checklist
- [ ] The LiteLLM proxy has internal ingress only, with a master key
- [ ] Webhooks and job routes: signature/OIDC verified, replay window, idempotent
- [ ] Tracking routes: signed tokens, rate-limited, no PII in URLs
- [ ] Rate limits per workspace on Server Actions and chat; per IP on auth
- [ ] CSP headers; CI check that no secrets appear in the client bundle
- [ ] Prompt-injection suite: malicious website content, prospect data and replies must not trigger tools, leak the system prompt or alter approvals
- [ ] Approval integrity test: a send whose variant content hash doesn't match the approved hash is refused
- [ ] `pnpm audit --prod` in CI
- [ ] Least-privilege service accounts (web, litellm, Cloud Tasks invoker)
- [ ] PII redaction in logs (emails masked via `pino` redact)

## Tasks
- [ ] OTel + logging setup
- [ ] Eval runner + datasets + CI job
- [ ] Hardening checklist items

## Acceptance criteria
- Any message or agent node links to its full trace
- The eval report is generated and every target is met
- The injection and approval-integrity suites pass
