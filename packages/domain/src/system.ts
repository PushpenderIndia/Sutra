import { z } from 'zod';
import {
  count,
  country,
  doc,
  id,
  locale,
  source,
  timeOfDay,
  timezone,
  usd,
  userId,
} from './common.ts';
import { pipelineNodeStatus, pipelineRunStatus } from './status.ts';

export const weekday = z.int().min(0).max(6);

export const workspaceSettings = doc({
  senderName: z.string(),
  senderTitle: z.string().optional(),
  signature: z.string().optional(),
  physicalAddress: z.string().optional(),
  defaultLocale: locale.default('en'),
  homeCountry: country,
  timezone,
  businessHours: z.object({ start: timeOfDay, end: timeOfDay, days: z.array(weekday) }),
  dailySendCap: count.default(150),
  warmup: z.object({
    enabled: z.boolean().default(true),
    startPerDay: count.default(20),
    increasePerDay: count.default(5),
    max: count.default(150),
  }),
  enabledSources: z.array(source).default(['search', 'lookalike', 'places', 'registry', 'csv']),
  /** Per-country stricter-only overrides of compliance pack values (PR 10). */
  complianceOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettings>;

export const pipelineRun = doc({
  status: pipelineRunStatus,
  /** Node the run started (or was re-run) from. */
  from: z.string().optional(),
  startedAt: z.date(),
  endedAt: z.date().optional(),
});
export type PipelineRun = z.infer<typeof pipelineRun>;

export const pipelineNode = doc({
  runId: id,
  nodeId: z.string(),
  parentId: z.string().optional(),
  agent: z.string(),
  status: pipelineNodeStatus,
  summary: z.string().optional(),
  startedAt: z.date().optional(),
  endedAt: z.date().optional(),
  tokens: count.default(0),
  costUsd: usd.default(0),
  toolCalls: z.array(z.object({ name: z.string(), at: z.date() })).default([]),
  error: z.string().optional(),
});
export type PipelineNode = z.infer<typeof pipelineNode>;

export const tab = z.enum(['business', 'prospects', 'campaigns', 'leads']);

export const chatMessage = doc({
  userId,
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        args: z.record(z.string(), z.unknown()),
        result: z.unknown().optional(),
        confirmed: z.boolean().optional(),
      }),
    )
    .default([]),
  context: z.object({ tab, selection: z.array(id) }),
});
export type ChatMessage = z.infer<typeof chatMessage>;

export const credentialProvider = z.enum(['google', 'apollo', 'hunter']);

/** A tenant secret, encrypted with `@sutra/config` `encrypt()`; plaintext is never stored. */
export const credential = doc({
  provider: credentialProvider,
  /** Set for per-user secrets such as a Google refresh token. */
  userId: userId.optional(),
  ciphertext: z.string().min(1),
  scopes: z.array(z.string()).optional(),
});
export type Credential = z.infer<typeof credential>;

/** The Gmail mailbox a workspace sends from (PR 11), with its push-sync cursor. */
export const mailbox = doc({
  /** Better Auth user whose Google credential sends; `fake` in `FAKE_MAIL` demo mode. */
  userId,
  email: z.email(),
  /** Gmail history cursor: replies are read from here on. */
  historyId: z.string().optional(),
  watchExpiresAt: z.date().optional(),
});
export type Mailbox = z.infer<typeof mailbox>;

export const actor = z.object({ kind: z.enum(['user', 'agent', 'system']), id: z.string() });
export type Actor = z.infer<typeof actor>;

export const auditEvent = doc({
  actor,
  action: z.string().min(1),
  entity: z.string(),
  entityId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  at: z.date(),
});
export type AuditEvent = z.infer<typeof auditEvent>;

export const llmUsage = doc({
  agent: z.string(),
  model: z.string(),
  tokensIn: count,
  tokensOut: count,
  /** List-price equivalent; $0 on the free tier. */
  costUsd: usd,
  at: z.date(),
});
export type LlmUsage = z.infer<typeof llmUsage>;

export const placesUsage = doc({
  /** `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  requests: count,
});
export type PlacesUsage = z.infer<typeof placesUsage>;

/** ADK session store (PR 06 `MongoSessionService`). */
export const adkSession = doc({
  appName: z.string(),
  userId: z.string(),
  sessionId: z.string(),
  state: z.record(z.string(), z.unknown()),
  lastUpdateTime: z.number(),
});
export type AdkSession = z.infer<typeof adkSession>;

/** ADK `app:` and `user:` scoped state, shared by every session of that app or user. */
export const adkState = doc({
  appName: z.string(),
  scope: z.enum(['app', 'user']),
  /** Set for `user` scope. */
  userId: z.string().optional(),
  state: z.record(z.string(), z.unknown()),
});
export type AdkState = z.infer<typeof adkState>;

export const adkEvent = doc({
  /** `_id` of the owning `adk_sessions` document. */
  sessionId: z.string(),
  invocationId: z.string(),
  author: z.string(),
  timestamp: z.number(),
  /** The serialised ADK event. */
  event: z.record(z.string(), z.unknown()),
});
export type AdkEvent = z.infer<typeof adkEvent>;
