# PR 10 — Compliance engine

**Branch:** `feat/10-compliance-engine` · **Depends on:** 03 · **Size:** M

## Why
This is a core differentiator and the "production-ready" story. **No email leaves Sutra without passing one pure, testable function.** Compliance rules are data (country packs), not `if` statements scattered through the code.

> ⚠️ The rule values are **starting defaults for the prototype**. Verify each country pack with counsel before real use. The UI shows the pack version and a "not legal advice" note.

## API

```ts
// packages/compliance/src/index.ts
export function check(input: {
  contact: Contact; company: Company; at: Date; workspace: WorkspaceSettings;
  consents: Consent[]; suppressions: Suppression[];
  recentSends: { at: Date }[]; mailboxSentToday: number;
}): Decision;

type Decision =
  | { allow: true; requirements: Requirement[]; packVersion: string }     // e.g. unsubscribe link, sender identity
  | { allow: false; reasons: Reason[]; retryAt?: Date; packVersion: string };
```
- **Pure function, no I/O.** A thin `checkFor(contactId)` loader in `@sutra/db` gathers the inputs.

## Country packs (`packages/compliance/packs/*.ts`, typed data)

```ts
export const SG: Pack = {
  country: 'SG', version: '2026.10',
  sendWindow: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },     // contact's timezone
  email: {
    basis: ['consent', 'legitimate_interest', 'existing_customer'],
    b2bOnly: true,                       // personal-looking addresses need consent
    unsubscribe: 'required', senderIdentity: 'required', physicalAddress: 'required',
  },
  frequency: { perContactPerWeek: 2, perDomainPerDay: 3 },
  retentionDays: 365,
};
```
Packs at launch: **SG, IN, ID, PH, MY, TH, VN, JP, AU, DEFAULT** (DEFAULT is the strictest and applies to unknown countries). Adding a country means adding one file.

## Rules evaluated (all reasons collected)
1. **Suppression**: email or domain opted out, bounced or manually blocked
2. **Lawful basis**: B2B legitimate interest is recorded automatically for business addresses found on public company pages, with the evidence URL; free-mail or personal-looking addresses need explicit consent
3. **Send window** in the contact's timezone → `retryAt`
4. **Frequency caps** per contact and per domain (don't flood one company)
5. **Mailbox caps**: daily cap and warm-up ramp (PR 11)
6. **Requirements** on allow: `unsubscribe_link`, `list_unsubscribe_header`, `sender_identity`, `physical_address`

## Opt-out (one handler)
`optOut({ email, source, evidence })` → suppression + stop every enrollment for that contact + audit. Triggered by:
- the one-click `List-Unsubscribe` header (RFC 8058) and the footer link `/u/[token]`
- the reply analyst classifying a reply as `unsubscribe` (PR 14)
- a chat command ("never email anyone at acme.com")

## Audit and data rights
- Every `check()` result for a send attempt goes into `audit_events`
- Contact **Export** and **Erase** actions. Erase anonymises PII but keeps a suppression hash so the person is never re-contacted.
- The retention task (inside the `maintenance` cron) anonymises stale prospects

## Where users see it
- Prospects tab: compliance status column ("OK", "Needs consent", "Suppressed")
- **Checkpoint 2 report** (PR 13): "212 ready · 9 blocked: 5 personal emails without consent, 3 suppressed, 1 duplicate domain cap"
- Settings: active packs, stricter-only overrides, suppression list

## Tasks
- [x] `check()` + types + packs
- [x] `optOut()` + unsubscribe page (`/u/[token]` confirm page + RFC 8058 one-click `POST /u/[token]/one-click`)
- [x] Export / erase / retention (`exportContact`, `eraseContact`, `retentionSweep` in `@sutra/db`)
- [ ] Settings UI + Prospects column — **deferred until the app shell (PR 05)**. The server side is ready: `PACKS` (also at `@sutra/compliance/packs` for client components), the `packOverride` schema for validating stricter-only overrides, `statusOf()` for the column and `summarize()` for the Checkpoint 2 line. The Export / Erase buttons on a contact go with this UI too.
- [x] Table-driven tests: at least 40 cases (send windows across timezones, DST in AU, caps, free-mail detection, suppression)

> Notes: `check()` also takes `domainSends` (for the per-domain cap) and `mailboxDay` (for the warm-up ramp), and returns `pack` alongside `packVersion`. `checkFor(workspaceId, contactId, { at?, actor? })` audits only when an `actor` is passed (a send attempt); dry runs aren't audited. `retentionSweep` is ready for the `maintenance` cron when that cron lands. Docs: [`docs/compliance.md`](../docs/compliance.md).

## Acceptance criteria
- [x] 100% branch coverage on `packages/compliance` (enforced by `pnpm test --coverage` in CI)
- [x] The Gmail send function only accepts an `AllowDecision` (enforced by type): `AllowDecision` is branded and only `check()` creates one; PR 11's `send()` takes it as a parameter
- [x] Opt-out stops all future sends within one job cycle (enrollments stopped, unsent messages cancelled, and `checkFor()` refuses anything in flight)
