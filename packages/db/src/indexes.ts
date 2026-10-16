import type { IndexDescription } from 'mongodb';
import type { CollectionName } from './collections.ts';

const unique = (key: IndexDescription['key'], extra: Partial<IndexDescription> = {}) => ({
  key,
  unique: true,
  ...extra,
});

/**
 * Indexes per collection, applied by `pnpm db:migrate`. Every collection also gets
 * `{ workspaceId: 1, createdAt: -1 }` for default listings.
 */
export const indexes: Record<CollectionName, IndexDescription[]> = {
  workspace_settings: [unique({ workspaceId: 1 })],
  business_profiles: [unique({ workspaceId: 1, version: -1 })],
  icps: [unique({ workspaceId: 1, version: -1 })],
  companies: [
    // Partial, so companies without a known domain don't collide on `null`.
    unique(
      { workspaceId: 1, domain: 1 },
      { partialFilterExpression: { domain: { $type: 'string' } } },
    ),
    { key: { workspaceId: 1, normalizedName: 1, country: 1 } },
    { key: { workspaceId: 1, status: 1, score: -1 } },
  ],
  contacts: [
    unique({ workspaceId: 1, email: 1 }),
    { key: { workspaceId: 1, companyId: 1 } },
    { key: { workspaceId: 1, status: 1 } },
  ],
  campaigns: [{ key: { workspaceId: 1, status: 1 } }],
  enrollments: [
    unique({ workspaceId: 1, campaignId: 1, contactId: 1 }),
    { key: { workspaceId: 1, contactId: 1 } },
    // The campaign engine's sweep for due steps.
    { key: { status: 1, nextRunAt: 1 } },
  ],
  messages: [
    unique({ idempotencyKey: 1 }),
    { key: { workspaceId: 1, contactId: 1, createdAt: 1 } },
    { key: { workspaceId: 1, campaignId: 1, variantId: 1, status: 1 } },
    { key: { threadId: 1 }, sparse: true },
  ],
  tracking_events: [
    { key: { workspaceId: 1, variantId: 1, kind: 1 } },
    { key: { messageId: 1, kind: 1 } },
  ],
  replies: [
    unique({ messageId: 1 }),
    { key: { workspaceId: 1, contactId: 1 } },
    { key: { workspaceId: 1, campaignId: 1, variantId: 1, intent: 1 } },
  ],
  meetings: [{ key: { workspaceId: 1, startsAt: 1 } }, { key: { workspaceId: 1, contactId: 1 } }],
  suppressions: [unique({ workspaceId: 1, scope: 1, value: 1 })],
  consents: [{ key: { workspaceId: 1, contactId: 1 } }],
  pipeline_runs: [{ key: { workspaceId: 1, status: 1 } }],
  pipeline_nodes: [
    unique({ workspaceId: 1, runId: 1, nodeId: 1 }),
    { key: { runId: 1, updatedAt: 1 } },
  ],
  chat_messages: [{ key: { workspaceId: 1, userId: 1, createdAt: 1 } }],
  credentials: [unique({ workspaceId: 1, provider: 1, userId: 1 })],
  audit_events: [
    { key: { workspaceId: 1, at: -1 } },
    { key: { workspaceId: 1, entity: 1, entityId: 1 } },
  ],
  llm_usage: [{ key: { workspaceId: 1, at: -1 } }],
  places_usage: [unique({ workspaceId: 1, month: 1 })],
  adk_sessions: [unique({ workspaceId: 1, appName: 1, userId: 1, sessionId: 1 })],
  adk_events: [{ key: { workspaceId: 1, sessionId: 1, timestamp: 1 } }],
};
