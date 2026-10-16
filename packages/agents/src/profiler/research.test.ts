import { describe, expect, it } from 'vitest';
import { fixtureResearch } from './fixtures.ts';
import { fakeWebResearcher, findingsFromChunks } from './research.ts';

describe('findingsFromChunks', () => {
  it('keeps web chunks with a valid URI and drops duplicates and junk', () => {
    const findings = findingsFromChunks([
      { web: { uri: 'https://news.example/a', title: 'Funding round' } },
      { web: { uri: 'https://news.example/a', title: 'duplicate' } },
      { web: { title: 'no uri' } },
      { web: { uri: 'not-a-url' } },
      {},
    ]);
    expect(findings).toEqual([{ text: 'Funding round', sourceUrl: 'https://news.example/a' }]);
  });

  it('falls back to the URL when a chunk has no title', () => {
    expect(findingsFromChunks([{ web: { uri: 'https://x.example/p' } }])).toEqual([
      { text: 'https://x.example/p', sourceUrl: 'https://x.example/p' },
    ]);
  });
});

describe('fakeWebResearcher', () => {
  it('returns canned findings per domain and empty results for unknown sites', async () => {
    const researcher = fakeWebResearcher(fixtureResearch);
    const found = await researcher.research({
      name: 'Flowbase',
      website: 'https://www.flowbase.io',
      summary: '',
    });
    expect(found.findings[0]?.sourceUrl).toMatch(/^https:\/\//);
    expect(found.queries.length).toBeGreaterThan(0);

    const unknown = await researcher.research({
      name: 'X',
      website: 'https://nope.test',
      summary: '',
    });
    expect(unknown).toEqual({ findings: [], queries: [] });
  });
});
