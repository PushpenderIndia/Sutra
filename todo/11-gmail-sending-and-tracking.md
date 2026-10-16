# PR 11 — Gmail sending and tracking

**Branch:** `feat/11-gmail-sending-and-tracking` · **Depends on:** 04, 10 · **Size:** M

## Why
Send from the user's own mailbox, thread follow-ups properly, protect deliverability, and measure what each variant does: opens (approximate), clicks and replies.

## Sending (`@sutra/mail`)
- **Gmail API with the user's OAuth** (incremental scopes `gmail.send`, `gmail.readonly`, requested at checkpoint 2)
- MIME via `nodemailer` `MailComposer` (text + HTML from a Markdown body). Headers:
  - `List-Unsubscribe: <https://APP/u/TOKEN>, <mailto:…>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  - Our own `Message-ID`; `In-Reply-To` / `References` on follow-ups so they **thread**
- **One send path:** `deliver(messageId)` loads the message → `compliance.checkFor()` → applies the requirements (footer with unsubscribe, sender identity, physical address) → `gmail.users.messages.send` → `transition(queued → sent)` → audit
- `send(msg, decision: AllowDecision, approval: ApprovedVariant)`: both tokens are **required by type**, so unapproved or non-compliant sends can't compile
- `FAKE_MAIL=true` swaps in a simulator that fakes delivery, opens, clicks and replies from a seeded script (demo mode)

## Deliverability guardrails
- **Warm-up ramp** per mailbox: start at `startPerDay` (default 20), add `increasePerDay` (default 5), up to `max` (default 150, well below Gmail's daily limits)
- **Jitter:** sends are spread across the contact's send window with random 2–9 minute gaps, never in bursts
- Plain-text-first templates, at most 2 links, no attachments on first touch, no URL shorteners
- Bounce detection (`mailer-daemon` replies) → suppression; pause the campaign if bounces exceed 5%
- A setup checklist shows SPF / DKIM / DMARC status for the sender's domain (DNS lookup)

## Tracking (for A/B testing)
| Signal | How | Reliability |
|---|---|---|
| **Reply** | Gmail push: `users.watch` → Pub/Sub → `/api/webhooks/gmail` (OIDC-verified) → `history.list` → match `threadId` | ✅ Primary metric |
| **Click** | Links rewritten to `/t/c/[token]` (HMAC-signed with `TRACKING_SECRET`, includes messageId, variantId, url) → 302 redirect | ✅ Good |
| **Open** | 1×1 pixel `/t/o/[token].gif` | ⚠️ Approximate. Privacy proxies prefetch images (inflating opens) and some clients block them (hiding opens). |

- **Machine-open filter:** opens within 10s of sending, or from known proxy user agents and IP ranges, are flagged `machine: true` and excluded from "human opens"
- The UI always labels opens as **"Opens ≈"** with a tooltip explaining why
- Click and open routes are public, rate-limited, and never reveal PII in the URL

## Tasks
- [ ] Gmail client, MIME builder, threading, `deliver()`
- [ ] Warm-up ramp + jittered scheduling + bounce handling
- [ ] Watch / Pub/Sub / history sync (renewed by the `maintenance` cron)
- [ ] Tracking routes, signed tokens, link rewriting, machine-open filter
- [ ] Fake mail simulator
- [ ] Deliverability checklist UI (SPF/DKIM/DMARC)

## Acceptance criteria
- Sending without approval or compliance tokens is a type error
- Follow-ups land in the same Gmail thread
- A reply appears within 30s; a duplicate Pub/Sub delivery creates no duplicates
- Day 1 of warm-up never sends more than `startPerDay` (tested)
- A tampered tracking token returns 404 and records nothing
