# PR 15 — A/B optimizer

**Branch:** `feat/15-ab-optimizer` · **Depends on:** 13, 14 · **Size:** M

## Why
Campaigns should get better on their own: send more traffic to winning variants, retire losers, and have AI write new challengers based on what's working. **Every new variant waits for human approval.**

## 1. Metrics per variant
From `messages`, `tracking_events` and `replies` (Mongo aggregation):
`sent, delivered, humanOpens≈, clicks, replies, positiveReplies (interested + meeting_request + question), meetings, unsubscribes, bounces`

**Reward** (configurable per campaign, default **positive reply**):
| Metric option | Use when |
|---|---|
| `positive_reply` (default) | Normal case. Most meaningful, but slowest to accumulate |
| `reply` | Small volumes |
| `click` | Campaigns built around a link (demo, content) |
| `open≈` | **Not available** as a reward (unreliable); display only |

## 2. Thompson-sampling bandit (pure function)
```ts
// packages/agents/src/optimizer/bandit.ts
export function chooseVariant(arms: ArmStats[], rng = Math.random): VariantId
// Beta(1 + successes, 1 + failures) per arm → sample → highest wins
export function probabilityBest(arms: ArmStats[], draws = 10_000): Record<VariantId, number>
```
- Used by the campaign engine (PR 13) at assignment time, per step
- **Exploration floor:** every active arm gets at least 10% of traffic until it has 30 sends
- **Retire** an arm when P(best) < 5% and it has at least 50 sends (auto, since retiring only reduces what's sent)
- **Declare a winner** when P(best) > 95% with at least 100 sends. Shown with a crown; traffic converges naturally.
- Small-sample honesty: the UI shows "not enough data yet" below 30 sends per arm, and confidence bands on every rate

## 3. Optimizer agent (`sutra-smart`, runs in `maintenance` and after every 50 sends per campaign)
1. **Analyse:** current arms with stats, hypotheses and dimensions; reply-analysis summaries (what interested replies mention, top objections); performance by locale and persona
2. **Insights** (shown on the Campaigns tab): "Question-style subjects lead in Indonesia (P(best) 91%)", "Replies mention pricing, so add a pricing hint to step 2"
3. **Propose challengers:** new variants for steps whose best arm has stalled, each changing **one dimension** of the current best, with a hypothesis. They pass the `qualityGate` (PR 12) → status `pending_approval`.
4. **Never activates anything itself.** Challengers sit in the approval queue.

## 4. Approval queue for variants
- Campaigns tab → **"Suggested variants (3)"** badge
- Each suggestion shows the current best arm vs the challenger as a diff, the hypothesis, the supporting data ("based on 142 sends, 11 replies"), and the expected traffic share if approved
- **Approve** / **Edit & approve** / **Reject** (owner/admin). Approving sets the variant `active`, and the bandit starts exploring it.
- Also available through chat: "show me the suggested variants", "approve the second one"
- Max **4 active arms per step**; approving a fifth asks which one to retire

## UI on variant cards
- Sent · replies (rate + confidence band) · clicks · opens≈ · **P(best)** bar · traffic share sparkline
- A step-level chart: cumulative reward per arm over time

## Tasks
- [ ] Metrics aggregation per variant (indexed)
- [ ] `chooseVariant`, `probabilityBest` + retire/winner rules + tests (seeded RNG)
- [ ] Wire the bandit into `campaign.step` assignment
- [ ] Optimizer agent: analysis, insights, challenger generation
- [ ] Suggested-variants approval UI + chat hooks
- [ ] Simulator: a fake-mail scenario where variant B truly converts 2× better, to verify convergence

## Acceptance criteria
- In the simulator, traffic shifts above 70% to the truly better arm within 300 sends
- No optimizer-generated variant is ever sent before approval (tested)
- Retired arms receive no new assignments
- Every insight cites the numbers it's based on
