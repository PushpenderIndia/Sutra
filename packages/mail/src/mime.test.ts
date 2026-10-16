import { describe, expect, it } from 'vitest';
import { headersOf } from '../test/fixtures.ts';
import { buildMime } from './mime.ts';
import { contentIssues, render } from './render.ts';

const base = {
  from: { name: 'Mei Tan', address: 'mei@pixelpress.example' },
  to: 'ana@acme.example',
  subject: 'Packaging for Acme',
  text: 'Hi',
  html: '<p>Hi</p>',
  messageId: '<64656d6f0000000000000009@pixelpress.example>',
  date: new Date('2026-10-13T01:30:00Z'),
};

describe('buildMime', () => {
  it('writes our Message-ID, text + HTML alternatives and RFC 8058 headers', async () => {
    const raw = (
      await buildMime({
        ...base,
        unsubscribe: {
          oneClick: 'https://app.example/u/tok/one-click',
          mailto: 'mailto:mei@pixelpress.example?subject=unsubscribe',
        },
      })
    ).toString();
    const h = headersOf(raw);
    expect(h['message-id']).toBe(base.messageId);
    expect(h['list-unsubscribe']).toBe(
      '<https://app.example/u/tok/one-click>, <mailto:mei@pixelpress.example?subject=unsubscribe>',
    );
    expect(h['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    expect(h['content-type']).toMatch(/^multipart\/alternative/);
    expect(h['in-reply-to']).toBeUndefined();
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).not.toMatch(/Content-Disposition: attachment/);
  });

  it('threads follow-ups with In-Reply-To (latest) and References (whole chain)', async () => {
    const references = ['<a@x.example>', '<b@x.example>'];
    const h = headersOf((await buildMime({ ...base, references })).toString());
    expect(h['in-reply-to']).toBe('<b@x.example>');
    expect(h.references).toBe('<a@x.example> <b@x.example>');
    expect(h['list-unsubscribe']).toBeUndefined();
  });
});

describe('render', () => {
  const sender = {
    name: 'Mei Tan',
    title: 'Lead',
    email: 'mei@p.example',
    physicalAddress: '1 Demo St',
  };
  const track = {
    click: (u: string) => `https://t.example/c?${encodeURIComponent(u)}`,
    pixel: 'https://t.example/o.gif',
  };

  it('adds the required footer, tracks HTML links only and escapes raw HTML', () => {
    const { text, html } = render({
      body: 'Hi <b>Ana</b>, see [samples](https://p.example/s).',
      requirements: [
        'unsubscribe_link',
        'list_unsubscribe_header',
        'sender_identity',
        'physical_address',
      ],
      sender,
      unsubscribeUrl: 'https://app.example/u/tok',
      track,
    });
    expect(text).toContain('samples (https://p.example/s)');
    expect(text).toContain(
      'Mei Tan, Lead\nmei@p.example\n1 Demo St\nUnsubscribe: https://app.example/u/tok',
    );
    expect(html).toContain('href="https://t.example/c?https%3A%2F%2Fp.example%2Fs"');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(html).toContain('href="https://app.example/u/tok"'); // unsubscribe is never tracked
    expect(html).toContain('<img src="https://t.example/o.gif" width="1" height="1"');
  });

  it('leaves out what the pack does not require', () => {
    const { text } = render({ body: 'Hi', requirements: [], sender });
    expect(text).toBe('Hi');
  });

  it('flags more than 2 links and URL shorteners', () => {
    expect(contentIssues('https://a.example https://b.example')).toEqual([]);
    expect(contentIssues('https://a.example https://b.example https://c.example')).toEqual([
      'More than 2 links',
    ]);
    expect(contentIssues('go https://bit.ly/abc')).toEqual(['URL shortener: https://bit.ly/abc']);
  });
});
