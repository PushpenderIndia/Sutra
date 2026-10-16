import { describe, expect, it } from 'vitest';
import { variantPairFixtures } from './fixtures.ts';
import { checkGrounding, linksIn, qualityGate, wordCount } from './quality-gate.ts';

const clean = {
  subject: 'Packaging for {{company}}',
  body: 'Hi {{firstName}},\n\n{{personalization}}\n\nWe print cups in 7 days. Worth a quick chat?\n\n{{senderName}}',
};

describe('qualityGate', () => {
  it('passes every fixture variant', () => {
    for (const pair of variantPairFixtures)
      for (const v of pair.variants) expect(qualityGate(v), v.subject).toMatchObject({ ok: true });
  });

  it('passes a clean template', () => {
    expect(qualityGate(clean)).toEqual({ ok: true, reasons: [] });
  });

  it('flags unknown merge fields', () => {
    const r = qualityGate({ ...clean, body: `${clean.body}\n{{discountCode}}` });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/discountCode/);
  });

  it('flags a subject over 80 characters', () => {
    const r = qualityGate({ ...clean, subject: 'x'.repeat(81) });
    expect(r.reasons.some((m) => /80 characters/.test(m))).toBe(true);
  });

  it('flags spam trigger words', () => {
    const r = qualityGate({ subject: 'Act now for a FREE guarantee', body: clean.body });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/Spam trigger/);
  });

  it('flags ALL CAPS shouting', () => {
    const r = qualityGate({ ...clean, body: `${clean.body}\nURGENT DEALS HERE` });
    expect(r.reasons.some((m) => /ALL CAPS/.test(m))).toBe(true);
  });

  it('flags a missing call to action', () => {
    const r = qualityGate({
      subject: 'Packaging for {{company}}',
      body: 'Hi {{firstName}}.\n\n{{personalization}}\n\nWe print cups.\n\n{{senderName}}',
    });
    expect(r.reasons).toContain('No clear call to action');
  });

  it('flags a body over 150 words', () => {
    const long = `Hi {{firstName}}, ${'word '.repeat(170)} worth a chat? {{senderName}}`;
    const r = qualityGate({ subject: 'Hi {{company}}', body: long });
    expect(r.reasons.some((m) => /over 150 words/.test(m))).toBe(true);
  });

  it('counts links in markdown and bare URLs, flagging more than two', () => {
    const body = 'a [one](https://a.example) [two](https://b.example) https://c.example ?';
    expect(linksIn(body)).toHaveLength(3);
    expect(qualityGate({ subject: 'Hi {{company}}', body }).reasons.join()).toMatch(/More than 2/);
  });

  it('ignores merge fields when counting words', () => {
    expect(wordCount('Hi {{firstName}}, two words')).toBe(4);
  });
});

describe('checkGrounding', () => {
  const cited = 'https://kopinusantara.example/news/bandung';
  const urls = [cited, 'https://kopinusantara.example'];

  it('accepts a line that cites a research URL', () => {
    expect(checkGrounding({ line: 'Congrats on Bandung.', sourceUrl: cited }, urls).ok).toBe(true);
  });

  it('rejects a line citing a URL not in the research', () => {
    const r = checkGrounding({ line: 'Congrats.', sourceUrl: 'https://made-up.example' }, urls);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/not present in the research/);
  });

  it('rejects a line that smuggles in a merge field', () => {
    const r = checkGrounding({ line: 'Hi {{firstName}}', sourceUrl: cited }, urls);
    expect(r.reasons.join()).toMatch(/merge fields/);
  });
});
