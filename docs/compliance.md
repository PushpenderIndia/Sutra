# Compliance engine

> **Not legal advice.** Every value in the country packs is a product default chosen for this prototype. Have counsel review each pack before you use it for real outreach. The UI shows the pack and its version on every decision.

No email leaves Sutra unless it passes `check()` in `@sutra/compliance`. `check()` is a pure, deterministic function. The rules live in country packs, which are plain data, so there is one engine and no per-country `if`s.

## API

```ts
import { check, type AllowDecision, type Decision } from '@sutra/compliance';

check(input: CheckInput, packs?: Record<string, Pack>): Decision;

interface CheckInput {
  contact: { email; timezone; status };
  company: { country; domain? };
  at: Date;
  workspace: { senderName; physicalAddress?; timezone; dailySendCap; warmup; complianceOverrides };
  consents: { basis; evidence }[];
  suppressions: { kind; scope; value }[];
  recentSends: { at: Date }[];   // sends to this contact
  domainSends: { at: Date }[];   // sends to anyone at the contact's domain
  mailboxSentToday: number;      // since local midnight, workspace time zone
  mailboxDay: number;            // days since the mailbox's first send (warm-up)
}

type Decision =
  | { allow: true;  requirements: Requirement[]; pack; packVersion }   // branded AllowDecision
  | { allow: false; reasons: Reason[]; retryAt?: Date; pack; packVersion };
```

- **`AllowDecision` is branded.** Only `check()` can create one, so a send function typed `send(msg, decision: AllowDecision, …)` won't compile without a passing check.
- **`retryAt`** is set only when every reason is temporary (send window, caps). It is the earliest time all of them lift, moved into the next send window.
- Server side, `@sutra/db` provides `checkFor(workspaceId, contactId, { at?, actor? })`, which loads the inputs from Mongo and calls `check()`. Pass `actor` for a real send attempt and the decision is written to `audit_events`. Leave it out for dry runs such as reports or the Prospects column. Agents and jobs receive it as an injectable hook (`type CheckFor`).

## Rules (all evaluated; every failure is reported)

| # | Rule | Reason code | Temporary? |
|---|---|---|---|
| 1 | Address, domain (including parent domains), company domain or erased-person hash suppressed; contact status `suppressed` | `suppressed` | no |
| 2 | Lawful basis accepted by the pack. Legitimate interest counts only with an evidence URL (the public page the address was found on). Free-mail addresses need explicit consent or an existing-customer record. | `no_lawful_basis`, `personal_email_without_consent` | no |
| 3 | Send window in the **contact's** time zone (DST-safe) | `outside_send_window` (`no_send_window` if overrides empty it) | yes |
| 4 | Per-contact cap (rolling 7 days) and per-domain cap (rolling 24 h) | `contact_frequency_cap`, `domain_frequency_cap` | yes |
| 5 | Mailbox daily cap and warm-up ramp: `min(dailySendCap, startPerDay + increasePerDay × day, max)` | `mailbox_daily_cap` | yes |
| 6 | Requirements: `unsubscribe_link`, `list_unsubscribe_header`, `sender_identity`, `physical_address`. A `required` one the workspace can't fill (for example, no address on file) blocks the send. | `missing_requirement` | no |

## Country packs (`packages/compliance/packs/`)

| Pack | Window (local) | Days | Bases | Contact/week | Domain/day | Address | Retention |
|---|---|---|---|---|---|---|---|
| SG | 09:00–18:00 | Mon–Fri | consent, LI, customer | 2 | 3 | required | 365 d |
| IN | 10:00–18:00 | Mon–Fri | consent, LI, customer | 2 | 3 | recommended | 180 d |
| ID | 09:00–17:00 | Mon–Fri | consent, LI, customer | 2 | 3 | recommended | 365 d |
| PH | 09:00–17:00 | Mon–Fri | consent, LI, customer | 2 | 3 | recommended | 365 d |
| MY | 09:00–17:00 | Mon–Thu | consent, LI, customer | 2 | 3 | recommended | 365 d |
| TH | 09:00–17:00 | Mon–Fri | consent, LI, customer | 2 | 3 | recommended | 365 d |
| VN | 08:30–17:00 | Mon–Fri | consent, customer | 1 | 2 | required | 180 d |
| JP | 09:00–18:00 | Mon–Fri | consent, LI, customer | 2 | 3 | required | 365 d |
| AU | 09:00–17:00 | Mon–Fri | consent, LI, customer | 2 | 3 | required | 365 d |
| DEFAULT | 10:00–16:00 | Mon–Thu | consent, customer | 1 | 2 | required | 180 d |

LI = legitimate interest (a business address published on a public company page, with the URL as evidence). Every pack requires an unsubscribe link, a `List-Unsubscribe` header and sender identity. Countries without a pack get **DEFAULT**, and a test checks that DEFAULT is at least as strict as every pack on every value.

To add a country, add one file in `packs/` and register it in `packs/index.ts`. Bump `version` whenever a value changes.

**Workspace overrides** (`workspace_settings.complianceOverrides[country]`, validated by `packOverride`) can only make a pack stricter. A looser value is ignored. Use the `DEFAULT` key to override the default pack.

## Opt-out, unsubscribe and data rights (`@sutra/db`)

- `optOut(workspaceId, { email } | { domain }, { source, evidence, actor? })` is the single opt-out handler. It adds the suppression, stops every active or paused enrollment, cancels unsent messages, marks the contacts `suppressed` and writes an audit event. It is idempotent. Sources: `list_unsubscribe`, `footer_link`, `reply`, `chat`, `manual`.
- Unsubscribe links: `unsubscribeLinks(workspaceId, contactId)` returns `{ page, oneClick }`. The tokens are HMAC-signed with `TRACKING_SECRET` and contain no PII.
  - `GET /u/[token]` shows a confirmation page. Mail scanners prefetch links, so a GET never unsubscribes on its own.
  - `POST /u/[token]/one-click` is the RFC 8058 one-click endpoint for `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- `exportContact()` returns everything stored about a person. `eraseContact()` anonymises their PII (contact, message bodies and recipients, reply text, consents) and keeps only an `email_hash` suppression, so they are never contacted again if they are rediscovered.
- `retentionSweep(workspaceId, now?)` anonymises prospects that have been inactive for longer than their pack's `retentionDays`. Contacts that are engaged, interested or have a meeting booked are kept. The `maintenance` cron calls it.
- Reports: `statusOf(decision)` returns the Prospects column value (`ok`, `needs_consent`, `suppressed` or `blocked`). `summarize(decisions)` returns the Checkpoint 2 line, for example `212 ready · 9 blocked: 5 personal emails without consent, 3 suppressed, 1 duplicate domain cap`.
