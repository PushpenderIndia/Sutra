'use server';
import { untrusted } from '@sutra/agents';
import { Companies, Contacts } from '@sutra/db';
import { companyStatus, country, id } from '@sutra/domain';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';
import { loadCampaigns } from '@/lib/data/campaigns';
import { loadThread } from '@/lib/data/leads';

/**
 * Read-only tools for the chat copilot (PR 16). They expose exactly what the tabs show, scoped to
 * the workspace by the same `action()` auth. Text that originates from scraped pages or replies is
 * wrapped in `<untrusted>` so the injection guard treats it as data, never instructions.
 */

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Finds prospect companies by name/industry, country, status or minimum score. */
export const searchProspects = action(
  z.object({
    query: z.string().max(100).optional().describe('Company name or keyword to match'),
    country: country.optional().describe('ISO-3166 alpha-2 country code, e.g. "TH"'),
    status: companyStatus.optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  async ({ workspaceId }, { query, country: cc, status, minScore, limit }) => {
    const filter: Record<string, unknown> = {};
    if (cc) filter.country = cc;
    if (status) filter.status = status;
    if (minScore !== undefined) filter.score = { $gte: minScore };
    if (query) {
      const rx = { $regex: escapeRegex(query), $options: 'i' };
      filter.$or = [{ name: rx }, { industry: rx }, { normalizedName: rx }];
    }
    const companies = await Companies.find(workspaceId, filter, {
      sort: { score: -1, createdAt: -1 },
      limit,
    });
    const contacts = await Contacts.find(
      workspaceId,
      { companyId: { $in: companies.map((c) => c._id) } },
      { projection: { companyId: 1, name: 1, title: 1, email: 1 } },
    );
    const byCompany = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const list = byCompany.get(c.companyId) ?? [];
      list.push(c);
      byCompany.set(c.companyId, list);
    }
    return {
      count: companies.length,
      prospects: companies.map((c) => ({
        id: c._id,
        name: c.name,
        country: c.country,
        city: c.city,
        industry: c.industry,
        score: c.score,
        fit: c.fit,
        status: c.status,
        topReason: c.scoreReasons[0]?.text,
        contacts: (byCompany.get(c._id) ?? []).map((p) => ({
          name: p.name,
          title: p.title,
          email: p.email,
        })),
      })),
    };
  },
);

/** A single company's profile and research. */
export const getCompany = action(
  z.object({ companyId: id }),
  async ({ workspaceId }, { companyId }) => {
    const c = await Companies.get(workspaceId, companyId);
    if (!c) throw new AppError('NOT_FOUND', 'That company is not in this workspace');
    return {
      id: c._id,
      name: c.name,
      domain: c.domain,
      website: c.website,
      country: c.country,
      city: c.city,
      industry: c.industry,
      size: c.size,
      status: c.status,
      score: c.score,
      fit: c.fit,
      research: c.research
        ? { summary: untrusted(c.research.summary, c.domain), sources: c.research.sources }
        : undefined,
    };
  },
);

/** Why a prospect scored the way it did: the blended score, fit and the reasons with their evidence. */
export const explainScore = action(
  z.object({ companyId: id }),
  async ({ workspaceId }, { companyId }) => {
    const c = await Companies.get(workspaceId, companyId);
    if (!c) throw new AppError('NOT_FOUND', 'That company is not in this workspace');
    return {
      id: c._id,
      name: c.name,
      score: c.score,
      fit: c.fit,
      reasons: c.scoreReasons.map((r) => ({
        text: r.text,
        weight: r.weight,
        evidence: untrusted(r.evidence, c.domain),
      })),
      signals: (c.research?.signals ?? []).map((s) => ({
        kind: s.kind,
        text: untrusted(s.text, s.sourceUrl),
        source: s.sourceUrl,
      })),
      matchedIcpSignals: c.research?.matchedIcpSignals ?? [],
    };
  },
);

/** Per-campaign, per-step winning variant by reply rate (opens are approximate). */
export const getCampaignStats = action(
  z.object({ campaignId: id.optional() }),
  async ({ workspaceId }, { campaignId }) => {
    const all = await loadCampaigns(workspaceId);
    const campaigns = campaignId ? all.filter((c) => c.id === campaignId) : all;
    return {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        steps: c.steps.map((s) => {
          const ranked = [...s.variants].sort(
            (a, b) =>
              (b.stats.sent ? b.stats.replies / b.stats.sent : 0) -
              (a.stats.sent ? a.stats.replies / a.stats.sent : 0),
          );
          return {
            step: s.index + 1,
            intent: s.intent,
            winner: ranked[0] && ranked[0].stats.sent > 0 ? ranked[0].letter : undefined,
            variants: s.variants.map((v) => ({
              letter: v.letter,
              status: v.status,
              sent: v.stats.sent,
              replies: v.stats.replies,
              clicks: v.stats.clicks,
              opensApprox: v.stats.opens,
            })),
          };
        }),
      })),
    };
  },
);

/** The A/B hypotheses and stats for one campaign's variants (optionally one step). */
export const getVariantInsights = action(
  z.object({ campaignId: id, stepIndex: z.number().int().min(0).optional() }),
  async ({ workspaceId }, { campaignId, stepIndex }) => {
    const [campaign] = (await loadCampaigns(workspaceId)).filter((c) => c.id === campaignId);
    if (!campaign) throw new AppError('NOT_FOUND', 'That campaign is not in this workspace');
    const steps =
      stepIndex === undefined
        ? campaign.steps
        : campaign.steps.filter((s) => s.index === stepIndex);
    return {
      id: campaign.id,
      name: campaign.name,
      steps: steps.map((s) => ({
        step: s.index + 1,
        angle: s.angle,
        variants: s.variants.map((v) => ({
          letter: v.letter,
          dimension: v.dimension,
          hypothesis: v.hypothesis,
          status: v.status,
          origin: v.origin,
          stats: v.stats,
        })),
      })),
    };
  },
);

/** The full conversation with one lead: the thread, any pending reply draft and booked meeting. */
export const getThread = action(
  z.object({ contactId: id }),
  async ({ workspaceId }, { contactId }) => {
    const thread = await loadThread(workspaceId, contactId);
    return {
      messages: thread.messages.map((m) => ({
        direction: m.direction,
        subject: m.subject,
        body: m.direction === 'inbound' ? untrusted(m.body, 'reply') : m.body,
        at: m.at,
        analysis: m.analysis,
      })),
      draft: thread.draft ? { id: thread.draft.id, subject: thread.draft.subject } : undefined,
      meeting: thread.meeting,
      canBook: thread.canBook,
    };
  },
);
