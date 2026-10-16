import { Personalizations } from '@sutra/db';
import type { Company, Contact, Id, Personalization } from '@sutra/domain';
import { recordStep } from '../pipeline/recorder.ts';
import { localeRules, untrusted } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import { type CopywriterDeps, copywriterDeps } from './deps.ts';
import { checkGrounding } from './quality-gate.ts';

/** Every source URL the research offers, for the grounding check and the prompt. */
export const researchUrls = (company: Pick<Company, 'research'>): string[] => {
  const research = company.research;
  if (!research) return [];
  return [...new Set([...research.sources, ...research.signals.map((s) => s.sourceUrl)])];
};

const researchText = (company: Company): string => {
  const research = company.research;
  if (!research) return '(no research available)';
  return [
    research.summary,
    ...research.signals.map((s) => `- [${s.kind}] ${s.text} (${s.sourceUrl})`),
  ]
    .filter(Boolean)
    .join('\n');
};

const promptFor = (contact: Contact, company: Company, urls: readonly string[]): string =>
  [
    `Write the personalisation line for ${contact.firstName ?? contact.name ?? 'the contact'} at ${company.name}.`,
    localeRules(contact.locale),
    `Cite exactly one of these research source URLs:\n${urls.map((u) => `- ${u}`).join('\n')}`,
    `Company research:\n${untrusted(researchText(company), 'research')}`,
  ].join('\n\n');

export interface PersonalizeInput {
  workspaceId: Id;
  contact: Contact;
  company: Company;
  campaignId: Id;
  stepIndex: number;
  deps?: CopywriterDeps;
}

/**
 * Writes (and caches, per contact + step) the grounded `{{personalization}}` line for one contact,
 * in their locale, at send time. Returns the cached line if one exists. Returns `undefined` when
 * the company has no citable research, so the caller can fall back to a plain greeting. The line is
 * regenerated once if it fails the grounding check; if it still cannot be grounded, `undefined`.
 */
export async function personalizeForContact(
  input: PersonalizeInput,
): Promise<Personalization | undefined> {
  const { workspaceId, contact, company, campaignId, stepIndex } = input;
  const key = { contactId: contact._id, campaignId, stepIndex };

  const cached = await Personalizations.findOne(workspaceId, key);
  if (cached) return cached;

  const urls = researchUrls(company);
  if (!urls.length) return undefined;

  const deps = input.deps ?? copywriterDeps();
  const run = (note?: string) =>
    runAgent({
      agent: deps.personalizer,
      workspaceId,
      sessionKey: `personalizer:${campaignId}:${contact._id}:${stepIndex}`,
      input: note
        ? `${promptFor(contact, company, urls)}\n\n${note}`
        : promptFor(contact, company, urls),
    });

  const line = await recordStep('personalizer', async () => {
    const first = (await run()).output;
    if (checkGrounding(first, urls).ok) return first;
    const reasons = checkGrounding(first, urls).reasons.join('; ');
    const second = (
      await run(`Your previous line failed: ${reasons}. Fix it and cite a listed URL.`)
    ).output;
    return checkGrounding(second, urls).ok ? second : undefined;
  });
  if (!line) return undefined;

  try {
    return await Personalizations.create(workspaceId, {
      ...key,
      locale: contact.locale,
      line: line.line,
      sourceUrl: line.sourceUrl,
    });
  } catch {
    // A concurrent send cached the same line first; return whatever is now stored.
    return (await Personalizations.findOne(workspaceId, key)) ?? undefined;
  }
}
