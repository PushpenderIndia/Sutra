# PR 13 — Approval and campaign engine (checkpoint 2)

**Branch:** `feat/13-approval-and-campaign-engine` · **Depends on:** 10, 11, 12 · **Size:** L

## Why
**A campaign runs only after a person approves it.** After approval, the engine sends each step at the right local time, assigns variants with the bandit, and stops the moment a contact replies.

## Checkpoint 2: "Approve campaign"
A `<Checkpoint>` panel on the Campaigns tab summarises everything being approved:
- **Audience:** N contacts (by fit, country, persona), with a link to the filtered Prospects table
- **Sequence:** steps, delays, variants (each one marked approved or edited)
- **Compliance report** (PR 10 dry run over the whole audience): ready vs blocked, with reasons
- **Schedule preview:** first sends per timezone ("Jakarta 09:12–11:40 WIB, Tokyo 09:05–10:30 JST"), warm-up ramp ("20 today, 25 tomorrow …")
- **Mailbox:** connect Gmail here if not yet connected (incremental OAuth)

**Approve** (owner/admin) stores `approvedBy`, `approvedAt`, and a **hash of the approved content** on the campaign and each variant, then resumes the pipeline (PR 06). Any later edit to an approved variant sets it back to `pending_approval`, and it's excluded from sends until re-approved.

## Campaign engine (deterministic)

```ts
// packages/agents/src/campaign/engine.ts — pure
export function nextAction(enr: Enrollment, campaign: Campaign, thread: Message[], now: Date): Action
// Action = stop(reason) | wait(until) | send(stepIndex) | skip(stepIndex, reason)
```

`campaign.step` job:
1. Load the enrollment, campaign and thread → `nextAction()`
2. `stop` on reply, meeting, opt-out, bounce or campaign paused
3. `send`: pick the variant with the **bandit** (PR 15; uniform random until it ships), from **approved, active variants only**. Store the assignment on the enrollment. Fill merge fields + personalisation (PR 12) → `compliance.checkFor()` → if blocked with `retryAt`, reschedule; otherwise `enqueue('deliver')` (PR 11)
4. Schedule the next step at `delayDays` later, inside the contact's send window, respecting the mailbox warm-up quota

## Job queue: one interface, two drivers

```ts
// apps/web/lib/jobs.ts
export const jobs = defineJobs({
  'pipeline.node':  { input: z.object({ runId: id, nodeId: z.string() }), handler: runNode },
  'campaign.step':  { input: z.object({ enrollmentId: id }), handler: runStep },
  'deliver':        { input: z.object({ messageId: id }), handler: deliver },
  'reply.analyze':  { input: z.object({ messageId: id }), handler: analyzeReply },
  'optimizer.run':  { input: z.object({ campaignId: id }), handler: optimize },
  'maintenance':    { cron: '0 3 * * *', handler: maintenance },   // Gmail watch renew, retention, optimizer sweep, stuck-job recovery
});
export const enqueue = jobs.enqueue;   // typed by job name
```
- **`inline` driver (dev):** runs in-process, or with `setTimeout` for `runAt`
- **`cloud-tasks` driver (prod):** HTTP task to `/api/jobs/<name>` with an OIDC token and `scheduleTime`; the task name comes from the idempotency key
- **One route** `app/api/jobs/[name]/route.ts`: verify OIDC → parse input → handler
- **Only one** Cloud Scheduler job (`maintenance`), which keeps Scheduler inside its free tier

## Controls
- Pause / resume a campaign, or a single contact (also via chat)
- A daily summary in the chat panel: "Sent 40, 3 replies (2 interested), 1 meeting booked"

## Tasks
- [ ] Checkpoint 2 panel: audience, compliance dry run, schedule preview, Gmail connect
- [ ] Approval action + content hashing + re-approval on edit
- [ ] `nextAction()` pure engine + exhaustive tests (fake clock, timezones)
- [ ] `runStep` with variant assignment + warm-up quota
- [ ] `defineJobs` + both drivers + job route + `maintenance`
- [ ] Pause/resume controls

## Acceptance criteria
- Nothing is sent before approval, and an edited variant is never sent until re-approved (tested)
- A reply after step 1 stops all later steps
- A step due at 22:00 in Manila is sent the next business day inside the send window
- Restarting the process mid-campaign loses no steps
