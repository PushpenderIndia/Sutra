import 'server-only';
import { type ArmStats, evaluateArms, MIN_CONFIDENT_SENDS, wilsonInterval } from '@sutra/agents';
import {
  Campaigns,
  Companies,
  Contacts,
  metricsFor,
  variantMetrics,
  WorkspaceSettings,
} from '@sutra/db';
import type {
  Campaign,
  CampaignStep,
  Contact,
  Id,
  Locale,
  VariantDimension,
  VariantMetrics,
} from '@sutra/domain';
import { rewardSuccesses } from '@sutra/domain';
import { approvalView, hasMailbox } from './approval';

/** Monte-Carlo draws for the P(best) shown on the Campaigns tab (lower than the optimizer's, for speed). */
const UI_DRAWS = 4000;

/** A letter per variant within its step: A, B, C… */
export const variantLetter = (index: number) => String.fromCharCode(65 + index);

/** A representative contact (and its company) to render a merge-field preview against. */
export interface SampleContact {
  firstName: string;
  company: string;
  senderName: string;
  locale: Locale;
}

const sampleFor = (
  contact: Contact | undefined,
  companyName: string | undefined,
  senderName: string,
): SampleContact => ({
  firstName: contact?.firstName ?? contact?.name?.split(' ')[0] ?? 'there',
  company: companyName ?? 'your company',
  senderName,
  locale: contact?.locale ?? 'en',
});

const rate = (successes: number, trials: number) => {
  const band = wilsonInterval(successes, trials);
  return { rate: band.rate, low: band.low, high: band.high };
};

/** Per-step bandit analysis: P(best), winner and traffic share for each active arm. */
function analyseStep(
  step: CampaignStep,
  metrics: Map<string, VariantMetrics>,
  reward: Campaign['reward'],
) {
  const active = step.variants.filter((v) => v.status === 'active');
  const arms: ArmStats[] = active.map((v) => {
    const m = metricsFor(metrics, v.id);
    return { id: v.id, sends: m.sent, successes: rewardSuccesses(m, reward) };
  });
  const evals = evaluateArms(arms, UI_DRAWS);
  const byId = new Map(evals.map((e) => [e.id, e]));
  const totalSends = arms.reduce((n, a) => n + a.sends, 0);
  return { byId, totalSends, activeCount: active.length };
}

/**
 * Campaigns with their steps, per-variant stats and bandit analysis (PR 15), plus the suggested-variant
 * approval queue and the optimizer's insights. Reply rate (with a confidence band) is the primary
 * metric; opens are human opens only and approximate (privacy proxies). Nothing suggested here has been
 * sent — challengers wait in the queue for a person to approve.
 */
export async function loadCampaigns(workspaceId: Id) {
  const campaigns = await Campaigns.find(workspaceId, {}, { sort: { createdAt: -1 } });
  const [metrics, settings, mailboxConnected] = await Promise.all([
    variantMetrics(workspaceId),
    WorkspaceSettings.findOne(workspaceId, {}),
    hasMailbox(workspaceId),
  ]);
  const senderName = settings?.senderName ?? 'Your name';

  return Promise.all(
    campaigns.map(async (c) => {
      const [contact] = await Contacts.find(
        workspaceId,
        c.persona ? { personaMatch: c.persona } : {},
        { limit: 1 },
      );
      const company = contact ? await Companies.get(workspaceId, contact.companyId) : null;
      const locales = [
        ...new Set(
          c.steps.flatMap((s) => s.variants.flatMap((v) => Object.keys(v.translations ?? {}))),
        ),
      ] as Locale[];

      const suggested: SuggestedVariant[] = [];

      const steps = c.steps.map((s, index) => {
        const { byId, totalSends, activeCount } = analyseStep(s, metrics, c.reward);
        const best = s.variants
          .filter((v) => v.status === 'active')
          .map((v, i) => ({ v, i, pBest: byId.get(v.id)?.pBest ?? 0 }))
          .reduce<{ v: CampaignStep['variants'][number]; i: number; pBest: number } | undefined>(
            (acc, cur) => (!acc || cur.pBest > acc.pBest ? cur : acc),
            undefined,
          );

        const variants = s.variants.map((v, i) => {
          const m = metricsFor(metrics, v.id);
          const ev = byId.get(v.id);
          const share = totalSends > 0 && v.status === 'active' ? m.sent / totalSends : 0;

          if (v.origin === 'optimizer' && v.status === 'pending_approval') {
            const bestMetrics = best ? metricsFor(metrics, best.v.id) : m;
            suggested.push({
              stepIndex: index,
              variantId: v.id,
              letter: variantLetter(i),
              dimension: v.dimension,
              hypothesis: v.hypothesis,
              subject: v.subject,
              body: v.body,
              flags: v.flags ?? [],
              best: best
                ? {
                    letter: variantLetter(best.i),
                    subject: best.v.subject,
                    body: best.v.body,
                    sends: bestMetrics.sent,
                    replies: bestMetrics.replies,
                  }
                : undefined,
              expectedShare: 1 / (activeCount + 1),
            });
          }

          return {
            id: v.id,
            letter: variantLetter(i),
            subject: v.subject,
            body: v.body,
            hypothesis: v.hypothesis,
            dimension: v.dimension,
            status: v.status,
            origin: v.origin,
            flags: v.flags ?? [],
            translations: v.translations ?? {},
            stats: {
              sent: m.sent,
              replies: m.replies,
              positiveReplies: m.positiveReplies,
              opens: m.opens,
              clicks: m.clicks,
            },
            /** Thompson-sampling P(best); 0 unless the variant is an active arm. */
            pBest: ev?.pBest ?? 0,
            winner: ev?.winner ?? false,
            /** False below the per-arm sample floor → the UI shows "not enough data yet". */
            enoughData:
              v.status === 'active' ? (ev?.enoughData ?? false) : m.sent >= MIN_CONFIDENT_SENDS,
            /** Share of this step's traffic the arm currently receives. */
            trafficShare: share,
            /** Reply rate with a Wilson confidence band. */
            replyBand: rate(m.replies, m.sent),
          };
        });

        return { index, delayDays: s.delayDays, intent: s.intent, angle: s.angle, variants };
      });

      return {
        id: c._id,
        name: c.name,
        persona: c.persona,
        status: c.status,
        reward: c.reward,
        approvedAt: c.approvedAt?.toISOString(),
        approval: await approvalView(workspaceId, c, settings, mailboxConnected),
        locales,
        sample: sampleFor(contact ?? undefined, company?.name, senderName),
        steps,
        /** Optimizer-proposed challengers awaiting approval (nothing here has been sent). */
        suggested,
        /** Optimizer insights, each citing the numbers behind it. */
        insights: (c.insights ?? []).map((i) => ({ text: i.text, stepIndex: i.stepIndex })),
      };
    }),
  );
}

export interface SuggestedVariant {
  stepIndex: number;
  variantId: string;
  letter: string;
  dimension: VariantDimension;
  hypothesis: string;
  subject: string;
  body: string;
  flags: string[];
  best?: { letter: string; subject: string; body: string; sends: number; replies: number };
  expectedShare: number;
}

export type CampaignView = Awaited<ReturnType<typeof loadCampaigns>>[number];
