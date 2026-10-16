# PR 03 — Domain schemas and DB layer

**Branch:** `feat/03-domain-and-db` · **Depends on:** 02 · **Size:** M

## Why
Zod schemas are the single source of truth. From one schema we get the TS type, API and Server Action validation, form validation, ADK tool parameters and Mongo `$jsonSchema` validators. A single generic `repository()` replaces per-collection data classes.

## `@sutra/domain` (isomorphic, no Node deps)

```ts
// packages/domain/src/common.ts
export const id = z.string().regex(/^[a-f0-9]{24}$/);
export const locale = z.enum(['en', 'hi', 'id', 'ms', 'th', 'vi', 'fil', 'ja', 'ko', 'zh', 'ta']);
export const country = z.string().length(2);            // ISO-3166 alpha-2
export const source = z.enum(['search', 'lookalike', 'places', 'registry', 'csv', 'apollo', 'hunter', 'chat']);
export const base = { _id: id, workspaceId: id, createdAt: z.date(), updatedAt: z.date() };
```

### Collections

| Collection | Purpose | Key fields |
|---|---|---|
| `business_profiles` | The user's own company (PR 07) | `website, name, oneLiner, offerings[], proofPoints[], customers[], geographies[], differentiators[], competitors[], toneOfVoice, sources[], status (draft/confirmed), version` |
| `icps` | Ideal customer profile + personas (PR 07) | `firmographics {industries[], sizes[], countries[], keywords[]}, personas[] {title, seniority, pains[], goals[], objections[]}, signals[], disqualifiers[], status, version` |
| `companies` | Prospect companies (deduped) | `name, domain?, country, city?, industry?, size?, sources[] {source, ref, at}, research?, score?, scoreReasons[], status` |
| `contacts` | People at those companies | `companyId, name?, title?, email, emailConfidence (verified/pattern/role), personaMatch?, locale, timezone, status` |
| `campaigns` | Sequence + experiment definitions | `name, icpVersion, steps[] {delayDays, variants[] {id, subject, body, status, origin (initial/optimizer), parentId?}}, status (draft/pending_approval/approved/running/paused/done), approvedBy?, approvedAt?` |
| `enrollments` | Contact × campaign state machine | `contactId, campaignId, stepIndex, status, nextRunAt, assignedVariants {stepIndex: variantId}, stopReason?` |
| `messages` | Every email in or out | `contactId, enrollmentId?, direction, variantId?, status, subject, body, gmailId?, threadId?, idempotencyKey` |
| `tracking_events` | Opens, clicks, unsubscribes | `messageId, variantId, kind (open/click/unsubscribe), machine (bool), url?, at` |
| `replies` | Reply analysis (PR 14) | `messageId, contactId, intent, sentiment, summaryEn, at` |
| `meetings` | Booked meetings | `contactId, startsAt, endsAt, calendarEventId, meetUrl` |
| `suppressions` | Opt-outs, bounces, DNC, manual | `kind, value (email/domain), reason, at` |
| `consents` | Lawful-basis ledger | `contactId, basis, source, evidence, at` |
| `pipeline_runs` / `pipeline_nodes` | Agent graph state (PR 06/17) | `runId, nodeId, parentId?, agent, status, summary, startedAt, endedAt, tokens, costUsd` |
| `chat_messages` | Chat sidebar history (PR 16) | `userId, role, content, toolCalls[], context {tab, selection[]}` |
| `credentials` | Encrypted tenant secrets | `provider, ciphertext` |
| `audit_events` | Every side effect | `actor (user/agent/system), action, entity, entityId, data, at` |
| `llm_usage`, `places_usage` | Cost and quota tracking | |
| `adk_sessions` / `adk_events` | ADK session store (PR 06) | |

Status enums (`CampaignStatus`, `VariantStatus`, `EnrollmentStatus`, `MessageStatus`, `ContactStatus`) are exported with their transition tables as data:
```ts
export const variantTransitions = {
  draft: ['pending_approval'], pending_approval: ['approved', 'rejected'],
  approved: ['active'], active: ['paused', 'retired'], paused: ['active', 'retired'], rejected: [], retired: [],
} as const satisfies Record<VariantStatus, readonly VariantStatus[]>;
```

## `@sutra/db` (server-only)

```ts
// packages/db/src/repository.ts
export function repository<S extends z.ZodObject>(name: string, schema: S) {
  type Doc = z.infer<S>;
  return {
    schema,
    create: (workspaceId, data) => ...,      // stamps ids/dates, validates
    get: (workspaceId, id) => ...,           // ALWAYS scoped by workspaceId
    find: (workspaceId, filter, opts?) => ...,
    update: (workspaceId, id, patch) => ...,
    transition: (workspaceId, id, from, to, table) => ...,   // atomic, guarded status change
    upsertBy: (workspaceId, key, data) => ...,
    col,                                      // escape hatch for aggregations
  };
}

export const Companies = repository('companies', company);
export const Contacts = repository('contacts', contact);
// ... one line per collection
```

- **Tenant isolation is built in.** Every method takes `workspaceId` first; there is no unscoped `find`.
- `transition()` uses `findOneAndUpdate({_id, status: from}, ...)`, so concurrent workers can't double-send.
- `indexes.ts`: a declarative list run by `pnpm db:migrate`, which also applies `$jsonSchema` validators generated from Zod (`z.toJSONSchema`).
- Unique indexes: `companies(workspaceId, domain)`, `contacts(workspaceId, email)`, `messages.idempotencyKey`.
- `audit(actor, action, entity, data)` helper.
- `pnpm db:seed --demo`: a demo workspace with a confirmed profile, prospects, a running campaign with variant stats, replies and meetings.

## Tasks
- [ ] Domain schemas + enums + transition tables
- [ ] Mongo client singleton (survives Next.js hot reload via `globalThis`)
- [ ] `repository()` + one line per collection
- [ ] `indexes.ts` + `db:migrate`
- [ ] `audit()` helper
- [ ] `db:seed --demo`
- [ ] Tests with `mongodb-memory-server`

## Acceptance criteria
- Reading another workspace's document is impossible through the API (tested)
- An invalid transition throws; two concurrent `transition()` calls → exactly one wins (tested)
- `db:migrate` is idempotent
- Seeded data stays well under the M0 512 MB limit
