import type { Requirement } from '@sutra/compliance';
import { Marked } from 'marked';

/** First touches must stay plain: at most this many links. */
export const MAX_LINKS = 2;
const SHORTENERS =
  /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|t\.ly|rb\.gy|tiny\.cc)$/i;
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/g;

export const linksIn = (body: string) => [...new Set(body.match(URL_PATTERN) ?? [])];

/** Deliverability guardrails on a body: why it must not be sent, if anything. */
export function contentIssues(body: string): string[] {
  const links = linksIn(body);
  const issues: string[] = [];
  if (links.length > MAX_LINKS) issues.push(`More than ${MAX_LINKS} links`);
  for (const link of links)
    if (SHORTENERS.test(new URL(link).hostname)) issues.push(`URL shortener: ${link}`);
  return issues;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export interface RenderInput {
  /** Markdown body, merge fields already filled. */
  body: string;
  requirements: readonly Requirement[];
  sender: { name: string; title?: string; email: string; physicalAddress?: string };
  /** The footer unsubscribe page. */
  unsubscribeUrl?: string;
  /** Click-tracking rewrite and open pixel, HTML part only. */
  track?: { click: (url: string) => string; pixel: string };
}

/**
 * Markdown body → plain text (links stay readable and untracked) + HTML (links rewritten for
 * click tracking, raw HTML escaped), each with the footer the compliance requirements ask for.
 */
export function render({ body, requirements, sender, unsubscribeUrl, track }: RenderInput) {
  const needs = (r: Requirement) => requirements.includes(r);
  const identity = needs('sender_identity')
    ? [sender.title ? `${sender.name}, ${sender.title}` : sender.name, sender.email]
    : [];
  const address =
    needs('physical_address') && sender.physicalAddress ? [sender.physicalAddress] : [];
  const footer = [...identity, ...address];
  const unsubscribe = needs('unsubscribe_link') && unsubscribeUrl;

  const text = [
    body.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)').trim(),
    [...footer, ...(unsubscribe ? [`Unsubscribe: ${unsubscribeUrl}`] : [])].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n--\n');

  const marked = new Marked({
    gfm: true,
    breaks: true,
    renderer: {
      html: ({ text }) => esc(text),
      link({ href, tokens }) {
        const url = track && /^https?:/i.test(href) ? track.click(href) : href;
        return `<a href="${esc(url)}">${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  const content = marked.parse(body.trim(), { async: false });
  const small = 'color:#6b7280;font-size:12px;line-height:1.5';
  const html = [
    '<!doctype html><html><body style="font-family:sans-serif;font-size:14px;line-height:1.5">',
    content,
    footer.length || unsubscribe
      ? `<p style="${small}">${[
          ...footer.map(esc),
          ...(unsubscribe
            ? [`<a href="${esc(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>`]
            : []),
        ].join('<br>')}</p>`
      : '',
    track ? `<img src="${esc(track.pixel)}" width="1" height="1" alt="" style="display:none">` : '',
    '</body></html>',
  ].join('');
  return { text, html };
}
