# PR 04 — Auth and workspaces

**Branch:** `feat/04-auth-and-workspaces` · **Depends on:** 03 · **Size:** S

## Why
Multi-tenant from day one, with no unauthenticated endpoints. Better Auth's `organization` plugin provides workspaces, invites and roles, so we write almost no auth code.

## Design
- **Better Auth** with the **MongoDB adapter**, sharing the `@sutra/db` client.
- **Google sign-in** requests the scopes needed later, with `access_type=offline` so we receive a refresh token:
  - `openid email profile`
  - `https://www.googleapis.com/auth/gmail.send`
  - `https://www.googleapis.com/auth/gmail.readonly` (reply detection)
  - `https://www.googleapis.com/auth/calendar.events`
  - Use incremental authorisation: request the Gmail and Calendar scopes from Settings → Connect mailbox, not at first login.
- **Organization plugin**: an organization is a workspace. Roles: `owner`, `admin`, `member` (members can view and chat; only owners and admins can confirm the profile, approve campaigns or variants, and change compliance settings).
- Workspace settings (a `workspace_settings` doc): `senderName, senderTitle, signature, defaultLocale, homeCountry, businessHours, dailySendCap, warmup {enabled, startPerDay, increasePerDay, max}`, enabled sources, compliance pack overrides. The company profile itself is **generated** in PR 07, not typed in.

## One guard for everything (DRY)

```ts
// apps/web/lib/action.ts
export function action<I extends z.ZodType, O>(
  input: I,
  handler: (ctx: { user; workspaceId; role }, data: z.infer<I>) => Promise<O>,
  opts?: { role?: Role },
) { /* get session → require active org → check role → parse input → handler → map errors */ }

// usage
export const createCampaign = action(campaignCreate, async ({ workspaceId }, data) =>
  Campaigns.create(workspaceId, data), { role: 'admin' });
```
- The same wrapper exists for route handlers: `route(input, handler, opts)`.
- `middleware.ts` redirects unauthenticated users from `/(app)/*` to `/sign-in`.
- Webhooks (`/api/webhooks/*`) and jobs (`/api/jobs/*`) skip session auth but **must** verify signatures (Google OIDC for Pub/Sub and Cloud Tasks; HMAC tokens for tracking links). Shared verifier helpers live in `apps/web/lib/verify.ts`.

## Tasks
- [x] Better Auth server + client, Mongo adapter, Google provider
- [x] Organization plugin, active-org on the session, workspace switcher hook
- [x] `action()` / `route()` wrappers
- [x] `middleware.ts` (Next 16 renamed it: `apps/web/proxy.ts`)
- [x] Sign-in page, then onboarding as **one input**: "What's your company website?" → creates the workspace (named from the domain) and starts the profiler pipeline (PR 07). Connecting Gmail is requested later, at checkpoint 2, just before sending.
- [x] Store Google refresh tokens in `credentials` via `encrypt()`

## Acceptance criteria
- Every Server Action and route goes through `action()` / `route()`. A grep test in CI fails if an exported action doesn't.
- A member can't change compliance settings (tested)
- A new user can sign in, enter a URL and land on the Business tab with the profiler running
