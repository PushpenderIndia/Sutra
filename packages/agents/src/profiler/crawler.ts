import { Readability } from '@mozilla/readability';
import type { CrawlPage, CrawlResult } from '@sutra/domain';
import { parseHTML } from 'linkedom';

// Readability's types name the DOM `Document` global, which this Node-only package doesn't load;
// linkedom documents are structurally compatible, so treat the class as a loose constructor.
const ReadabilityCtor = Readability as unknown as new (
  doc: object,
) => {
  parse(): { textContent?: string | null } | null;
};

/** Fetches and cleans a company's own site. Deterministic: this is a tool, not an LLM agent. */
export interface Crawler {
  crawl(website: string): Promise<CrawlResult>;
}

/** Per-domain cache of crawl results (7 days). The default keeps them in memory. */
export interface CrawlCache {
  get(domain: string): CrawlResult | undefined;
  set(domain: string, result: CrawlResult): void;
}

/** Fetches the readable text of a JS-only page when scraping yields too little (Gemini `url_context`). */
export type JsFallback = (url: string) => Promise<string | undefined>;

export interface CrawlerOptions {
  fetch?: typeof fetch;
  cache?: CrawlCache;
  now?: () => Date;
  /** Homepage plus this many ranked same-domain pages. */
  maxPages?: number;
  pageTimeoutMs?: number;
  maxTotalBytes?: number;
  /** Fallback for JS-only sites; skipped when absent. */
  fallback?: JsFallback;
}

const DAY = 24 * 60 * 60 * 1000;
export const CRAWL_TTL_MS = 7 * DAY;
const DEFAULTS = { maxPages: 12, pageTimeoutMs: 10_000, maxTotalBytes: 1_500_000 } as const;
/** Below this many characters the homepage is treated as JS-only and the fallback kicks in. */
const THIN_TEXT = 200;

/** Path hints, highest value first; a page's rank is the index of the first hint its path matches. */
const HINTS: readonly RegExp[] = [
  /\/(products?|services|solutions)(\/|$)/i,
  /\/about(\/|-us)?(\/|$)/i,
  /\/(customers|case-studies|case-study|clients)(\/|$)/i,
  /\/pricing(\/|$)/i,
  /\/(blog|news|insights)(\/|$)/i,
  /\/(careers|jobs)(\/|$)/i,
  /\/contact(\/|$)/i,
];
const BLOG = /\/(blog|news|insights)(\/|$)/i;
/** Non-HTML resources we never fetch. */
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|json|pdf|zip|mp4|woff2?|xml|rss)(\?|$)/i;

export const domainOf = (website: string) =>
  new URL(website).hostname.replace(/^www\./, '').toLowerCase();

/** A cache that keeps results in memory and expires them after {@link CRAWL_TTL_MS}. */
export function memoryCache(now: () => Date = () => new Date()): CrawlCache {
  const store = new Map<string, CrawlResult>();
  return {
    get(domain) {
      const hit = store.get(domain);
      if (!hit) return undefined;
      if (now().getTime() - hit.fetchedAt.getTime() > CRAWL_TTL_MS) {
        store.delete(domain);
        return undefined;
      }
      return hit;
    },
    set: (domain, result) => void store.set(domain, result),
  };
}

const text = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Clean one HTML page into a {@link CrawlPage} plus the `alt` text of any logo-wall images. */
export function extractPage(url: string, html: string): { page: CrawlPage; logos: string[] } {
  const { document } = parseHTML(html);
  const meta = (name: string) =>
    document
      .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
      ?.getAttribute('content') ?? undefined;
  const title = text(
    document.querySelector('title')?.textContent || meta('og:title') || document.title || '',
  );
  const description = meta('description') ?? meta('og:description');
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .map((h) => text(h.textContent ?? ''))
    .filter(Boolean)
    .slice(0, 30);

  let body = '';
  try {
    // Readability mutates the document, so parse a fresh copy for the article text.
    const clone = parseHTML(html).document;
    body = new ReadabilityCtor(clone).parse()?.textContent ?? '';
  } catch {
    body = '';
  }
  if (text(body).length < THIN_TEXT) body = document.body?.textContent ?? body;

  const logos = [...document.querySelectorAll('img[alt]')]
    .map((img) => ({
      alt: text(img.getAttribute('alt') ?? ''),
      src: (img.getAttribute('src') ?? '').toLowerCase(),
      cls: (img.getAttribute('class') ?? '').toLowerCase(),
    }))
    .filter(({ alt, src, cls }) => alt && /logo|customer|client|partner|brand/.test(src + cls))
    .map(({ alt }) => alt);

  return {
    page: { url, title, description, headings, text: text(body).slice(0, 20_000) },
    logos: [...new Set(logos)],
  };
}

/** Same-origin, non-asset links ranked by URL hints: ~`maxPages` best pages, blogs capped at two. */
export function rankLinks(homeUrl: string, hrefs: readonly string[], maxPages: number): string[] {
  const home = new URL(homeUrl);
  const scored = new Map<string, number>();
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, home);
    } catch {
      continue;
    }
    url.hash = '';
    if (url.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')) continue;
    if (ASSET.test(url.pathname)) continue;
    const clean = url.toString();
    if (clean === home.toString() || clean === `${home.toString()}/`) continue;
    const rank = HINTS.findIndex((h) => h.test(url.pathname));
    if (rank === -1) continue;
    scored.set(clean, Math.min(scored.get(clean) ?? Infinity, rank));
  }
  const blogs: string[] = [];
  const ordered = [...scored.entries()].sort((a, b) => a[1] - b[1]).map(([u]) => u);
  const picked: string[] = [];
  for (const url of ordered) {
    if (BLOG.test(new URL(url).pathname)) {
      if (blogs.length >= 2) continue;
      blogs.push(url);
    }
    picked.push(url);
    if (picked.length >= maxPages) break;
  }
  return picked;
}

/** Parses `robots.txt` into an "is this path allowed for us" predicate (user-agent `*`). */
export function parseRobots(body: string): (path: string) => boolean {
  const disallow: string[] = [];
  let applies = false;
  for (const raw of body.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const [field, ...rest] = line.split(':');
    if (!field || !rest.length) continue;
    const key = field.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') applies = value === '*';
    else if (key === 'disallow' && applies && value) disallow.push(value);
  }
  return (path) => !disallow.some((rule) => path.startsWith(rule));
}

/** Crawls a live site over HTTP: robots, ranked pages, readable text, caching and a JS fallback. */
export class HttpCrawler implements Crawler {
  private readonly fetch: typeof fetch;
  private readonly cache: CrawlCache;
  private readonly now: () => Date;
  private readonly opts: Required<Omit<CrawlerOptions, 'fetch' | 'cache' | 'now' | 'fallback'>>;
  private readonly fallback?: JsFallback;

  constructor(options: CrawlerOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
    this.cache = options.cache ?? memoryCache(this.now);
    this.fallback = options.fallback;
    this.opts = {
      maxPages: options.maxPages ?? DEFAULTS.maxPages,
      pageTimeoutMs: options.pageTimeoutMs ?? DEFAULTS.pageTimeoutMs,
      maxTotalBytes: options.maxTotalBytes ?? DEFAULTS.maxTotalBytes,
    };
  }

  private async get(url: string): Promise<string | undefined> {
    try {
      const res = await this.fetch(url, {
        signal: AbortSignal.timeout(this.opts.pageTimeoutMs),
        headers: { 'user-agent': 'SutraBot/1.0 (+https://sutra.ai)', accept: 'text/html' },
        redirect: 'follow',
      });
      if (!res.ok) return undefined;
      const type = res.headers.get('content-type') ?? '';
      if (type && !type.includes('html')) return undefined;
      return await res.text();
    } catch {
      return undefined;
    }
  }

  async crawl(website: string): Promise<CrawlResult> {
    const origin = new URL(website).origin;
    const domain = domainOf(website);
    const cached = this.cache.get(domain);
    if (cached) return cached;

    const robotsBody = await this.get(new URL('/robots.txt', origin).toString());
    const allowed = robotsBody ? parseRobots(robotsBody) : () => true;

    const pages: CrawlPage[] = [];
    const logos = new Set<string>();
    let bytes = 0;
    let usedFallback = false;

    const homeHtml = await this.get(origin);
    if (homeHtml) {
      bytes += homeHtml.length;
      const { page, logos: ls } = extractPage(origin, homeHtml);
      if (page.text.length < THIN_TEXT && this.fallback) {
        const fallbackText = await this.fallback(origin).catch(() => undefined);
        if (fallbackText && fallbackText.length > page.text.length) {
          page.text = text(fallbackText).slice(0, 20_000);
          usedFallback = true;
        }
      }
      pages.push(page);
      for (const l of ls) logos.add(l);

      const links = [...parseHTML(homeHtml).document.querySelectorAll('a[href]')].map(
        (a) => a.getAttribute('href') ?? '',
      );
      for (const url of rankLinks(origin, links, this.opts.maxPages)) {
        if (bytes >= this.opts.maxTotalBytes) break;
        if (!allowed(new URL(url).pathname)) continue;
        const html = await this.get(url);
        if (!html) continue;
        bytes += html.length;
        const extracted = extractPage(url, html);
        pages.push(extracted.page);
        for (const l of extracted.logos) logos.add(l);
      }
    }

    const result: CrawlResult = {
      website: origin,
      domain,
      pages,
      logos: [...logos],
      fetchedAt: this.now(),
      usedFallback,
    };
    this.cache.set(domain, result);
    return result;
  }
}

/** A {@link Crawler} serving fixture HTML through {@link HttpCrawler}, for tests and demo mode. */
export function fakeCrawler(
  sites: Record<string, { robotsTxt?: string; pages: Record<string, string> }>,
  options: CrawlerOptions = {},
): Crawler {
  const fetchFixture: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const domain = url.hostname.replace(/^www\./, '').toLowerCase();
    const site = sites[domain];
    const body =
      url.pathname === '/robots.txt'
        ? site?.robotsTxt
        : (site?.pages[url.pathname] ?? site?.pages[url.pathname.replace(/\/$/, '') || '/']);
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  return new HttpCrawler({ ...options, fetch: options.fetch ?? fetchFixture });
}
