import { GoogleGenAI } from '@google/genai';
import { env } from '@sutra/config';
import type { CompanyResearch } from '@sutra/domain';
import { companyResearch, locale as localeSchema } from '@sutra/domain';
import { z } from 'zod';

/** What the researcher is told so it searches for what the company's own site omits. */
export interface CompanyResearchInput {
  name: string;
  domain: string;
  website?: string;
  /** A short description from prospecting, to focus the searches. */
  summary?: string;
  /** The ICP's buying signals, so the researcher can report which it actually observed. */
  buyingSignals: readonly string[];
}

/**
 * Per-company research for the enricher. Every signal must cite a real `sourceUrl`; grounded
 * against live web content, so the implementation decides which signals it can defend. Returns
 * `undefined` when nothing citable was found (never invalid, unsourced research).
 */
export interface CompanyResearcher {
  research(input: CompanyResearchInput): Promise<CompanyResearch | undefined>;
}

/** The structured shape we ask Gemini for; kept lenient and parsed defensively. */
const rawResearch = z.object({
  summary: z.string().optional(),
  signals: z
    .array(
      z.object({
        kind: z.string().optional(),
        text: z.string().optional(),
        sourceUrl: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .optional(),
  matchedIcpSignals: z.array(z.string()).optional(),
  websiteLanguage: z.string().optional(),
});

const SIGNAL_KINDS = companyResearch.shape.signals.element.shape.kind.options;
const asKind = (raw: string | undefined): (typeof SIGNAL_KINDS)[number] =>
  SIGNAL_KINDS.includes(raw as (typeof SIGNAL_KINDS)[number])
    ? (raw as (typeof SIGNAL_KINDS)[number])
    : 'other';

const validUrl = (raw: string | undefined): string | undefined => z.url().safeParse(raw).data;

const extractJsonObject = (text: string): unknown => {
  const body = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
};

/** Grounding chunk URLs that back the research, deduped and validated. */
const groundingUrls = (chunks: readonly { web?: { uri?: string } }[] | undefined): string[] => {
  const urls = new Set<string>();
  for (const { web } of chunks ?? []) {
    const url = validUrl(web?.uri);
    if (url) urls.add(url);
  }
  return [...urls];
};

const PROMPT = (input: CompanyResearchInput) =>
  [
    `Research the company ${input.name} (${input.website ?? `https://${input.domain}`}) for a B2B sales team.`,
    input.summary ? `Context: ${input.summary}` : '',
    'Using Google Search and by reading the company website, find recent, verifiable facts: hiring, funding, expansion, product launches, pain points, tech stack and news. Prefer reputable, recent sources.',
    input.buyingSignals.length
      ? `The buyer is looking for these signals; report which you actually observe:\n${input.buyingSignals.map((s) => `- ${s}`).join('\n')}`
      : '',
    'Reply with ONLY a JSON object: {summary (<=600 chars), signals: [{kind (one of hiring|funding|expansion|launch|pain_point|tech_stack|news|other), text, sourceUrl (the exact page the fact came from), date (optional)}], matchedIcpSignals: [the listed signals you observed, verbatim], websiteLanguage (ISO-639-1, e.g. en, id, vi, optional)}.',
    'Every signal MUST include the real sourceUrl it came from. Omit any fact you cannot attribute to a URL. Do not invent facts, companies or sources.',
  ]
    .filter(Boolean)
    .join('\n\n');

/**
 * Builds validated {@link CompanyResearch} from a parsed model reply plus the grounding URLs.
 * Signals without a usable `sourceUrl` are dropped; a result with no sources at all is `undefined`.
 * Exported for the test seam (no network).
 */
export function buildResearch(
  raw: unknown,
  grounded: readonly string[],
): CompanyResearch | undefined {
  const parsed = rawResearch.safeParse(raw);
  const value = parsed.success ? parsed.data : {};

  const signals = (value.signals ?? [])
    .map((s) => {
      const sourceUrl = validUrl(s.sourceUrl);
      return sourceUrl && s.text
        ? { kind: asKind(s.kind), text: s.text, sourceUrl, date: s.date }
        : undefined;
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .slice(0, 10);

  const sources = [...new Set([...grounded, ...signals.map((s) => s.sourceUrl)])];
  if (!sources.length) return undefined;

  const candidate = {
    summary: (value.summary ?? '').slice(0, 600),
    signals,
    matchedIcpSignals: value.matchedIcpSignals ?? [],
    websiteLanguage: localeSchema.safeParse(value.websiteLanguage).data,
    sources,
  };
  return companyResearch.safeParse(candidate).data;
}

/**
 * Gemini + Google Search grounding and `url_context` (free grounded quota) for per-company research.
 * Best-effort: a failed grounded call yields `undefined` rather than failing the whole enricher.
 */
export class GeminiCompanyResearcher implements CompanyResearcher {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey ?? env.GEMINI_API_KEY });
    this.model = options.model ?? 'gemini-2.5-flash';
  }

  async research(input: CompanyResearchInput): Promise<CompanyResearch | undefined> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: PROMPT(input),
        config: { tools: [{ googleSearch: {} }, { urlContext: {} }], temperature: 0.2 },
      });
      const grounded = groundingUrls(response.candidates?.[0]?.groundingMetadata?.groundingChunks);
      return buildResearch(extractJsonObject(response.text ?? ''), grounded);
    } catch {
      return undefined;
    }
  }
}

/** A {@link CompanyResearcher} that returns canned research per domain, for tests and demo mode. */
export function fakeCompanyResearcher(
  byDomain: Record<string, CompanyResearch>,
): CompanyResearcher {
  return { research: async ({ domain }) => byDomain[domain.toLowerCase()] };
}
