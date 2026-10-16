import 'server-only';
import { Campaigns, db, Messages, Replies, TrackingEvents } from '@sutra/db';
import type { Id } from '@sutra/domain';

type Counts = Map<string, number>;

/** Documents per `variantId` in `repo` matching `match` (which must scope the workspace). */
async function countBy(repo: { name: string }, match: object): Promise<Counts> {
  const rows = (await db()
    .collection(repo.name)
    .aggregate([{ $match: match }, { $group: { _id: '$variantId', n: { $sum: 1 } } }])
    .toArray()) as { _id: string | null; n: number }[];
  return new Map(rows.flatMap((r) => (r._id ? [[r._id, r.n] as const] : [])));
}

/** A letter per variant within its step: A, B, C… */
export const variantLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * Campaigns with their steps and per-variant stats. Opens are human opens only and are
 * approximate (privacy proxies); replies and clicks are what the optimizer uses.
 */
export async function loadCampaigns(workspaceId: Id) {
  const campaigns = await Campaigns.find(workspaceId, {}, { sort: { createdAt: -1 } });
  const scope = { workspaceId };
  const [sent, replies, opens, clicks] = await Promise.all([
    countBy(Messages, { ...scope, direction: 'outbound', status: 'sent' }),
    countBy(Replies, scope),
    countBy(TrackingEvents, { ...scope, kind: 'open', machine: false }),
    countBy(TrackingEvents, { ...scope, kind: 'click', machine: false }),
  ]);
  return campaigns.map((c) => ({
    id: c._id,
    name: c.name,
    persona: c.persona,
    status: c.status,
    approvedAt: c.approvedAt?.toISOString(),
    steps: c.steps.map((s, index) => ({
      index,
      delayDays: s.delayDays,
      intent: s.intent,
      angle: s.angle,
      variants: s.variants.map((v, i) => ({
        id: v.id,
        letter: variantLetter(i),
        subject: v.subject,
        body: v.body,
        hypothesis: v.hypothesis,
        dimension: v.dimension,
        status: v.status,
        origin: v.origin,
        stats: {
          sent: sent.get(v.id) ?? 0,
          replies: replies.get(v.id) ?? 0,
          opens: opens.get(v.id) ?? 0,
          clicks: clicks.get(v.id) ?? 0,
        },
      })),
    })),
  }));
}
export type CampaignView = Awaited<ReturnType<typeof loadCampaigns>>[number];
