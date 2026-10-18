import { isDemoMode } from '@sutra/db';
import type { ContactDraft, CrawlResult, Id, Persona, Source } from '@sutra/domain';
import { matchPersona, resolveEmail, roleEmail } from '@sutra/sources';
import { untrusted } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import { type ProspectorDeps, prospectorDeps } from './deps.ts';

/** Pages most likely to list people, so the extractor sees them even in a large crawl. */
const PEOPLE_PAGE = /\/(contact|about|team|leadership|people|our-team|company)(\/|$)/i;

const pagesToText = (crawl: CrawlResult): string => {
  const ranked = [...crawl.pages].sort(
    (a, b) => Number(PEOPLE_PAGE.test(b.url)) - Number(PEOPLE_PAGE.test(a.url)),
  );
  return ranked
    .slice(0, 6)
    .map((p) => [`## ${p.title} — ${p.url}`, p.description, p.text].filter(Boolean).join('\n'))
    .join('\n\n');
};

export interface FindContactsInput {
  workspaceId: Id;
  /** The company to find people at; needs a domain to build/verify email addresses. */
  company: { name: string; domain: string; website?: string };
  personas: readonly Persona[];
  /** The source the company was found by; recorded on each discovered contact. */
  source: Source;
  deps?: ProspectorDeps;
}

/**
 * Finds the people worth contacting at a company, for companies without contacts from a paid source
 * (also used by PR 09):
 * 1. crawl the company's own contact/about/team pages
 * 2. `contactExtractor` pulls out `{name, title, email?}`
 * 3. map each title to an ICP persona
 * 4. decide the email and its confidence (published → verified; pattern + MX → pattern; else a role
 *    inbox → role). No SMTP probing.
 */
export async function findContacts(input: FindContactsInput): Promise<ContactDraft[]> {
  const { workspaceId, company, personas, source } = input;
  const deps = input.deps ?? prospectorDeps(await isDemoMode(workspaceId));
  const domain = company.domain;
  const website = company.website ?? `https://${domain}`;

  const crawl = await deps.crawler.crawl(website).catch(() => undefined);
  const text = crawl ? pagesToText(crawl) : '';

  let people: { name?: string; title?: string; email?: string }[] = [];
  if (text.trim()) {
    const { output } = await runAgent({
      agent: deps.contactExtractor,
      workspaceId,
      sessionKey: `contactFinder:${workspaceId}:${domain}`,
      input: `Company: ${company.name} (${website})\n\nPages:\n${untrusted(text, 'pages')}`,
    });
    people = output.contacts;
  }

  const drafts: ContactDraft[] = [];
  const seen = new Set<string>();
  for (const person of people) {
    const resolved = await resolveEmail(
      { name: person.name, publishedEmail: person.email, domain },
      (d) => deps.emailVerifier.hasMx(d),
    );
    if (!resolved || seen.has(resolved.email)) continue;
    seen.add(resolved.email);
    drafts.push({
      kind: 'contact',
      companyDomain: domain,
      companyName: company.name,
      name: person.name,
      firstName: person.name?.trim().split(/\s+/)[0],
      title: person.title,
      email: resolved.email,
      emailConfidence: resolved.confidence,
      source,
      personaMatch: matchPersona(person.title, personas),
    });
  }

  // Nothing published and nothing guessable: fall back to the company's role inbox (lower score).
  if (!drafts.length) {
    const email = roleEmail(domain);
    if (!seen.has(email))
      drafts.push({
        kind: 'contact',
        companyDomain: domain,
        companyName: company.name,
        email,
        emailConfidence: 'role',
        source,
      });
  }
  return drafts;
}
