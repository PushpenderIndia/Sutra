import { EMPTY_METRICS, type Id, POSITIVE_INTENTS, type VariantMetrics } from '@sutra/domain';
import type { Document } from 'mongodb';
import { db } from './client.ts';
import { Messages, Replies, TrackingEvents } from './collections.ts';

type GroupRow = { _id: string | null; n: number };

/** Counts documents per `variantId` in one collection (the filter must already scope the workspace). */
async function groupByVariant(collection: string, match: Document): Promise<Map<string, number>> {
  const rows = (await db()
    .collection(collection)
    .aggregate([{ $match: match }, { $group: { _id: '$variantId', n: { $sum: 1 } } }])
    .toArray()) as GroupRow[];
  return new Map(rows.flatMap((r) => (r._id ? [[r._id, r.n] as const] : [])));
}

/**
 * Per-variant metrics for a whole workspace, aggregated from `messages`, `tracking_events` and
 * `replies` (all indexed by `{ workspaceId, …, variantId }`). Variant ids are workspace-unique, so a
 * caller reads the metrics for any campaign's variant straight out of the returned map — no per-call
 * join. `sent` (= `delivered`) is the bandit's trial count; opens are human opens only and approximate.
 */
export async function variantMetrics(workspaceId: Id): Promise<Map<string, VariantMetrics>> {
  const scope = { workspaceId };
  const [sent, bounces, opens, clicks, unsubscribes, replies, positive] = await Promise.all([
    groupByVariant(Messages.name, { ...scope, direction: 'outbound', status: 'sent' }),
    groupByVariant(Messages.name, { ...scope, direction: 'outbound', status: 'bounced' }),
    groupByVariant(TrackingEvents.name, { ...scope, kind: 'open', machine: false }),
    groupByVariant(TrackingEvents.name, { ...scope, kind: 'click', machine: false }),
    groupByVariant(TrackingEvents.name, { ...scope, kind: 'unsubscribe' }),
    groupByVariant(Replies.name, scope),
    groupByVariant(Replies.name, { ...scope, intent: { $in: [...POSITIVE_INTENTS] } }),
  ]);

  const ids = new Set<string>([
    ...sent.keys(),
    ...bounces.keys(),
    ...opens.keys(),
    ...clicks.keys(),
    ...unsubscribes.keys(),
    ...replies.keys(),
  ]);
  const out = new Map<string, VariantMetrics>();
  for (const id of ids) {
    const delivered = sent.get(id) ?? 0;
    out.set(id, {
      sent: delivered,
      delivered,
      opens: opens.get(id) ?? 0,
      clicks: clicks.get(id) ?? 0,
      replies: replies.get(id) ?? 0,
      positiveReplies: positive.get(id) ?? 0,
      unsubscribes: unsubscribes.get(id) ?? 0,
      bounces: bounces.get(id) ?? 0,
    });
  }
  return out;
}

/** The metrics for one variant, or all-zero metrics when it has none yet. */
export const metricsFor = (map: Map<string, VariantMetrics>, variantId: string): VariantMetrics =>
  map.get(variantId) ?? EMPTY_METRICS;
