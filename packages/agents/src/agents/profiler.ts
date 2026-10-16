import { businessProfile, icp } from '@sutra/domain';
import { defineAgent } from '../agent.ts';
import { noFabrication } from '../prompts/base.ts';

/**
 * Turns crawl text and web research into the structured business profile. The crawl and research
 * arrive as the run input, wrapped in `<untrusted>`; the profiler reads them as data only.
 */
export const profileWriter = defineAgent({
  name: 'profileWriter',
  description: 'Writes the business profile from crawl text and web research.',
  model: 'sutra-smart',
  output: businessProfile,
  temperature: 0.3,
  instruction: [
    'You are a B2B analyst building a crisp profile of a company from its website and web research, so later agents know what it sells, to whom and why.',
    noFabrication,
    'Rules:',
    "- Set `website` to exactly {website} and `name` to the company's real name.",
    '- `oneLiner`: at most 160 characters, plain and specific — no slogans.',
    '- Every `proofPoints[].sourceUrl` and `customers[].sourceUrl` must be a real URL taken from the crawl or research; if you cannot cite a source, leave the item out.',
    '- `customers` are named organisations the company sells to (logos, case studies), not its own products.',
    '- `geographies` and ICP countries use ISO-3166 alpha-2 upper case (e.g. SG, ID).',
    '- `sources` lists the URLs you actually relied on (at least one).',
    'Reply with only the JSON object for the business profile.',
  ],
});

/**
 * Derives the ICP and buyer personas from a confirmed-shape business profile. The profile is
 * trusted input (we wrote it); the ICP must be explainable from it.
 */
export const icpBuilder = defineAgent({
  name: 'icpBuilder',
  description: 'Derives the ideal customer profile and buyer personas from the business profile.',
  model: 'sutra-smart',
  output: icp,
  temperature: 0.3,
  instruction: [
    'You define the ideal customer profile (ICP) and buyer personas for the company described in the business profile given as input.',
    noFabrication,
    'Grounding rule: the ICP must be explainable from the profile. If the profile lists `customers`, the industries and countries those customers belong to must appear in the ICP, or `rationale` must say why not.',
    'Rules:',
    '- `firmographics.countries` and any country field use ISO-3166 alpha-2 upper case.',
    '- Give 1–4 personas, each with a realistic title, alt titles, seniority, pains, goals and objections.',
    '- `buyingSignals` are observable triggers ("hiring SDRs", "opened a new outlet", "raised a round"); `disqualifiers` are reasons to skip a company.',
    "- `rationale`: at most 600 characters, citing the profile's proof points and customers.",
    'Reply with only the JSON object for the ICP.',
  ],
});
