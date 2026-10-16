import { describe, expect, it, vi } from 'vitest';
import {
  domainOf,
  extractPage,
  fakeCrawler,
  HttpCrawler,
  memoryCache,
  parseRobots,
  rankLinks,
} from './crawler.ts';
import { profilerFixtures } from './fixtures.ts';

const html = (body: string) =>
  `<!doctype html><html><head><title>Acme Co</title><meta name="description" content="We sell boxes"></head><body>${body}</body></html>`;

/** Serves the fixture sites over an injectable, call-counting fetch. */
function fixtureFetch(sites = profilerFixtures) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const domain = url.hostname.replace(/^www\./, '').toLowerCase();
    const site = sites[domain];
    const page =
      url.pathname === '/robots.txt'
        ? site?.robotsTxt
        : (site?.pages[url.pathname] ?? site?.pages[url.pathname.replace(/\/$/, '') || '/']);
    return page === undefined
      ? new Response('', { status: 404 })
      : new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
  });
}

describe('extractPage', () => {
  it('pulls title, description, headings, readable text and customer logos', () => {
    const page = profilerFixtures['flowbase.io']?.pages['/'] as string;
    const { page: extracted, logos } = extractPage('https://flowbase.io', page);
    expect(extracted.title).toContain('Flowbase');
    expect(extracted.description).toMatch(/automates/i);
    expect(extracted.headings).toContain('Automate the busywork your ops team hates');
    expect(extracted.text).toMatch(/no-code workflow platform/);
    expect(logos).toEqual(['Northstar Bank', 'Harbour Logistics', 'Meadow Foods']);
  });

  it('falls back to body text when there is no article', () => {
    const { page } = extractPage(
      'https://acme.test',
      html('<p>Just a short paragraph about boxes.</p>'),
    );
    expect(page.text).toContain('boxes');
  });
});

describe('rankLinks', () => {
  it('keeps same-domain hinted pages, ranks products first and caps blogs at two', () => {
    const ranked = rankLinks(
      'https://acme.test',
      [
        '/pricing',
        '/products',
        '/blog/a',
        '/blog/b',
        '/blog/c',
        'https://acme.test/about',
        'https://other.test/products',
        '/style.css',
        '#top',
      ],
      12,
    );
    expect(ranked[0]).toBe('https://acme.test/products');
    expect(ranked).not.toContain('https://other.test/products');
    expect(ranked.some((u) => u.endsWith('/style.css'))).toBe(false);
    expect(ranked.filter((u) => u.includes('/blog/')).length).toBe(2);
  });

  it('obeys the page cap', () => {
    expect(rankLinks('https://acme.test', ['/about', '/pricing', '/contact'], 2)).toHaveLength(2);
  });
});

describe('parseRobots', () => {
  it('disallows paths for user-agent *', () => {
    const allowed = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /private\n');
    expect(allowed('/about')).toBe(true);
    expect(allowed('/admin/users')).toBe(false);
    expect(allowed('/private')).toBe(false);
  });

  it('ignores rules for other agents', () => {
    const allowed = parseRobots(
      'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /tmp\n',
    );
    expect(allowed('/about')).toBe(true);
    expect(allowed('/tmp/x')).toBe(false);
  });
});

describe('HttpCrawler', () => {
  it('crawls the homepage and ranked pages, collects logos and sets the origin', async () => {
    const fetch = fixtureFetch();
    const crawler = new HttpCrawler({ fetch, cache: memoryCache() });
    const result = await crawler.crawl('https://www.flowbase.io/about');

    expect(result.website).toBe('https://www.flowbase.io');
    expect(result.domain).toBe('flowbase.io');
    expect(result.usedFallback).toBe(false);
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    expect(paths[0]).toBe('/');
    expect(paths).toContain('/products');
    expect(paths).toContain('/customers');
    expect(result.logos).toContain('Cedar Retail');
    // /admin is disallowed by robots and never fetched.
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/admin'))).toBe(false);
  });

  it('skips robots-disallowed pages even when they are ranked', async () => {
    const sites = {
      'acme.test': {
        robotsTxt: 'User-agent: *\nDisallow: /pricing\n',
        pages: {
          '/': html('<a href="/pricing">p</a><a href="/about">a</a>'),
          '/pricing': html('<p>secret pricing</p>'),
          '/about': html('<p>about us and what we do all day long here</p>'),
        },
      },
    };
    const fetch = fixtureFetch(sites);
    const result = await new HttpCrawler({ fetch, cache: memoryCache() }).crawl(
      'https://acme.test',
    );
    const paths = result.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/about');
    expect(paths).not.toContain('/pricing');
  });

  it('serves a cached result within the TTL and refetches after it', async () => {
    const fetch = fixtureFetch();
    const now = vi.fn(() => new Date('2026-01-01T00:00:00Z'));
    const crawler = new HttpCrawler({ fetch, cache: memoryCache(now), now });
    await crawler.crawl('https://flowbase.io');
    const afterFirst = fetch.mock.calls.length;
    await crawler.crawl('https://flowbase.io');
    expect(fetch.mock.calls.length).toBe(afterFirst); // cache hit, no new fetches

    now.mockReturnValue(new Date('2026-02-01T00:00:00Z')); // 31 days later, past the 7-day TTL
    await crawler.crawl('https://flowbase.io');
    expect(fetch.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('uses the JS fallback when the homepage has almost no text', async () => {
    const sites = { 'spa.test': { pages: { '/': html('<div id="root"></div>') } } };
    const fallback = vi.fn(
      async () =>
        'This single-page app renders its marketing copy entirely in JavaScript at runtime.',
    );
    const result = await new HttpCrawler({
      fetch: fixtureFetch(sites),
      cache: memoryCache(),
      fallback,
    }).crawl('https://spa.test');
    expect(fallback).toHaveBeenCalledOnce();
    expect(result.usedFallback).toBe(true);
    expect(result.pages[0]?.text).toMatch(/single-page app/);
  });
});

describe('fakeCrawler', () => {
  it('crawls fixture sites without the network', async () => {
    const result = await fakeCrawler(profilerFixtures).crawl('https://cargowing.com');
    expect(result.domain).toBe('cargowing.com');
    expect(result.pages.length).toBeGreaterThan(1);
    expect(domainOf('https://www.cargowing.com/services')).toBe('cargowing.com');
  });
});
