import type { PersonalizationLine, Variant } from '@sutra/domain';
import { mergeFieldsIn, unknownMergeFields } from '@sutra/domain';

/** First touches stay plain: at most this many links in a body (matches `@sutra/mail`). */
export const MAX_LINKS = 2;
/** Deliverability ceiling for a cold first touch. */
export const MAX_WORDS = 150;
export const MAX_SUBJECT = 80;

/** Classic spam-filter trigger words; kept lower-cased and matched on word boundaries. */
export const SPAM_WORDS = [
  'free',
  'guarantee',
  'guaranteed',
  'act now',
  'limited time',
  'risk-free',
  'risk free',
  'click here',
  'buy now',
  'order now',
  'cash',
  'cheap',
  'discount',
  'winner',
  'congratulations',
  'no obligation',
  '100%',
  '$$$',
] as const;

const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]"']+/g;
const CTA_HINT =
  /\b(call|chat|meet|meeting|demo|reply|book|schedule|sample|worth|open to|free to|available|interested|happy to|should i|shall i|let me know|get in touch)\b/i;

/** Distinct links in a body (markdown and bare URLs). */
export function linksIn(body: string): string[] {
  const urls = new Set<string>();
  for (const [, href] of body.matchAll(MARKDOWN_LINK)) if (href) urls.add(href);
  for (const url of body.replace(MARKDOWN_LINK, '').match(BARE_URL) ?? []) urls.add(url);
  return [...urls];
}

/** Words that are ALL CAPS and at least four letters long (shouty), ignoring merge fields. */
const shoutyWords = (text: string): string[] =>
  (text.replace(/\{\{[^}]+\}\}/g, ' ').match(/\b[A-Z]{4,}\b/g) ?? []).filter(
    (w) => !/^(HTTP|HTTPS)$/.test(w),
  );

/** Words in a body, with merge fields and markdown link URLs removed, for a length estimate. */
export function wordCount(body: string): number {
  const text = body
    .replace(MARKDOWN_LINK, '$&')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/[#*_>`~-]/g, ' ');
  return text.split(/\s+/).filter(Boolean).length;
}

const spamHitsIn = (text: string): string[] => {
  const hay = text.toLowerCase();
  return SPAM_WORDS.filter((word) =>
    /^[a-z ]+$/.test(word)
      ? new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`).test(hay)
      : hay.includes(word),
  );
};

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

/**
 * The deterministic quality gate for a variant template (PR 12). Checks merge fields are valid,
 * the subject fits, there is a call to action, and the body stays within spam-lint limits
 * (trigger words, links, ALL CAPS, length). Grounding of the per-contact personalisation line is
 * checked separately by {@link checkGrounding}, since the template only holds a placeholder.
 */
export function qualityGate(variant: Pick<Variant, 'subject' | 'body'>): GateResult {
  const { subject, body } = variant;
  const reasons: string[] = [];

  const unknown = [...unknownMergeFields(subject), ...unknownMergeFields(body)];
  if (unknown.length) reasons.push(`Unknown merge fields: ${[...new Set(unknown)].join(', ')}`);

  if (!subject.trim()) reasons.push('Subject is empty');
  else if (subject.length > MAX_SUBJECT) reasons.push(`Subject over ${MAX_SUBJECT} characters`);

  const links = linksIn(body);
  if (links.length > MAX_LINKS) reasons.push(`More than ${MAX_LINKS} links`);

  const words = wordCount(body);
  if (words > MAX_WORDS) reasons.push(`Body over ${MAX_WORDS} words (${words})`);

  const spam = [...new Set([...spamHitsIn(subject), ...spamHitsIn(body)])];
  if (spam.length) reasons.push(`Spam trigger words: ${spam.join(', ')}`);

  const shouty = [...new Set([...shoutyWords(subject), ...shoutyWords(body)])];
  if (shouty.length >= 2 || (shouty.length && subject.toUpperCase() === subject))
    reasons.push(`ALL CAPS: ${shouty.join(', ')}`);

  const hasCta = CTA_HINT.test(body) || body.includes('?') || !!links.length;
  if (!hasCta) reasons.push('No clear call to action');

  return { ok: reasons.length === 0, reasons };
}

/**
 * Grounding check for a per-contact personalisation line: its cited `sourceUrl` must be one of the
 * URLs present in the company's research (the acceptance rule). Returns the reasons it failed.
 */
export function checkGrounding(
  line: Pick<PersonalizationLine, 'line' | 'sourceUrl'>,
  researchUrls: readonly string[],
): GateResult {
  const reasons: string[] = [];
  if (!line.line.trim()) reasons.push('Personalisation line is empty');
  if (mergeFieldsIn(line.line).length) reasons.push('Personalisation line contains merge fields');
  if (!researchUrls.includes(line.sourceUrl))
    reasons.push('Personalisation cites a URL not present in the research');
  return { ok: reasons.length === 0, reasons };
}
