import { GoogleGenAI } from '@google/genai';
import { env } from '@sutra/config';
import type { ResearchFinding, WebResearchResult } from '@sutra/domain';

/** What the researcher is told about the company, so it searches for what the site doesn't say. */
export interface ResearchInput {
  name: string;
  website: string;
  /** A short description from the crawl, to focus the searches. */
  summary: string;
}

/**
 * Searches the web for what a company's own site omits: news, funding, reviews, competitors,
 * market and geography. Every fact keeps its `sourceUrl`.
 */
export interface WebResearcher {
  research(input: ResearchInput): Promise<WebResearchResult>;
}

const PROMPT = (input: ResearchInput) =>
  `Research the company ${input.name} (${input.website}). ${input.summary}\n` +
  `Using Google Search, find recent news, funding, hiring, reviews, named competitors, the markets and countries it operates in, and any third-party proof of traction. Prefer reputable, recent sources. Summarise what you find in a few short paragraphs, each tied to the pages you used.`;

/** Grounding chunks with a usable web URI → findings; duplicate URLs are collapsed. */
export function findingsFromChunks(
  chunks: readonly { web?: { uri?: string; title?: string } }[] | undefined,
): ResearchFinding[] {
  const byUrl = new Map<string, ResearchFinding>();
  for (const { web } of chunks ?? []) {
    const sourceUrl = web?.uri;
    if (!sourceUrl || byUrl.has(sourceUrl)) continue;
    try {
      new URL(sourceUrl);
    } catch {
      continue;
    }
    byUrl.set(sourceUrl, { text: web.title?.trim() || sourceUrl, sourceUrl });
  }
  return [...byUrl.values()];
}

/** Calls Gemini directly with the `google_search` grounding tool (free-tier grounded quota). */
export class GeminiWebResearcher implements WebResearcher {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey ?? env.GEMINI_API_KEY });
    this.model = options.model ?? 'gemini-flash-latest';
  }

  async research(input: ResearchInput): Promise<WebResearchResult> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: PROMPT(input),
        config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
      });
      const meta = response.candidates?.[0]?.groundingMetadata;
      return {
        findings: findingsFromChunks(meta?.groundingChunks),
        queries: meta?.webSearchQueries ?? [],
      };
    } catch {
      // Research is best-effort; a failed grounded call must not fail the whole profiler.
      return { findings: [], queries: [] };
    }
  }
}

/** A {@link WebResearcher} that returns canned findings per domain, for tests and demo mode. */
export function fakeWebResearcher(byDomain: Record<string, WebResearchResult>): WebResearcher {
  return {
    research: async ({ website }) => {
      const domain = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
      return byDomain[domain] ?? { findings: [], queries: [] };
    },
  };
}
