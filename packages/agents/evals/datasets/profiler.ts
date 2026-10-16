import { type Criterion, type EvalReport, gradeSet, metric } from '../framework.ts';

/**
 * Profiler + ICP eval (PR 07): five websites, each with the slice of the profiler's output the rubric
 * grades — the offerings, the proof points and their cited source URLs, and the ICP shape. The rubric
 * here is the deterministic, checkable part: offerings are present and described, every proof point is
 * grounded in a source the profiler listed, and the ICP is sensibly shaped (industries, countries, at
 * least one persona). The softer "accurate offerings / sensible ICP" judgement runs through the LLM
 * judge in `pnpm eval --live`.
 */

interface ProfileCase {
  website: string;
  offerings: { name: string; description: string }[];
  proofPoints: { text: string; sourceUrl: string }[];
  /** URLs the profiler cited as its sources; every proof point must link to one of these. */
  sources: string[];
  icp: { industries: string[]; countries: string[]; personas: number };
}

export const profilerCases: ProfileCase[] = [
  {
    website: 'https://flowbase.io',
    offerings: [
      { name: 'Workflow builder', description: 'Drag-and-drop automation for ops teams.' },
    ],
    proofPoints: [{ text: '400+ companies', sourceUrl: 'https://flowbase.io/about' }],
    sources: ['https://flowbase.io', 'https://flowbase.io/about'],
    icp: { industries: ['Banking', 'Logistics'], countries: ['SG', 'AU'], personas: 2 },
  },
  {
    website: 'https://kopinusantara.example',
    offerings: [
      { name: 'Specialty coffee', description: 'Outlet chain across Jakarta and Bandung.' },
    ],
    proofPoints: [
      { text: 'Opened a Bandung outlet', sourceUrl: 'https://kopinusantara.example/news/bandung' },
    ],
    sources: ['https://kopinusantara.example', 'https://kopinusantara.example/news/bandung'],
    icp: { industries: ['Food & Beverage'], countries: ['ID'], personas: 1 },
  },
  {
    website: 'https://kayatoastclub.example',
    offerings: [
      { name: 'Heritage café', description: 'Several outlets with a new delivery menu.' },
    ],
    proofPoints: [
      { text: 'Islandwide delivery launched', sourceUrl: 'https://kayatoastclub.example/delivery' },
    ],
    sources: ['https://kayatoastclub.example', 'https://kayatoastclub.example/delivery'],
    icp: { industries: ['Food & Beverage', 'Hospitality'], countries: ['SG'], personas: 2 },
  },
  {
    website: 'https://lioncitybakes.example',
    offerings: [
      { name: 'Bakery group', description: 'Neighbourhood outlets opening across Singapore.' },
    ],
    proofPoints: [
      { text: 'New Tampines outlet', sourceUrl: 'https://lioncitybakes.example/stores' },
    ],
    sources: ['https://lioncitybakes.example', 'https://lioncitybakes.example/stores'],
    icp: { industries: ['Retail', 'Food & Beverage'], countries: ['SG'], personas: 1 },
  },
  {
    website: 'https://phosaigonhouse.example',
    offerings: [
      { name: 'Vietnamese restaurants', description: 'Scaling outlets in Ho Chi Minh City.' },
    ],
    proofPoints: [
      { text: 'Third District 1 outlet', sourceUrl: 'https://phosaigonhouse.example/tin-tuc' },
    ],
    sources: ['https://phosaigonhouse.example', 'https://phosaigonhouse.example/tin-tuc'],
    icp: { industries: ['Hospitality'], countries: ['VN'], personas: 1 },
  },
];

const rubric: readonly Criterion<ProfileCase>[] = [
  {
    id: 'offerings-described',
    description: 'at least one offering, each with a name and a description',
    check: (c) =>
      c.offerings.length > 0 && c.offerings.every((o) => !!o.name && o.description.length > 10),
  },
  {
    id: 'proof-points-grounded',
    description: 'every proof point cites a URL the profiler listed as a source',
    check: (c) =>
      c.proofPoints.length > 0 && c.proofPoints.every((p) => c.sources.includes(p.sourceUrl)),
  },
  {
    id: 'icp-sensible',
    description: 'ICP has industries, at least one country and at least one persona',
    check: (c) => c.icp.industries.length > 0 && c.icp.countries.length > 0 && c.icp.personas >= 1,
  },
];

/** Rubric full-pass rate across the five website profiles. Target ≥ 90%. */
export function evaluateProfiler(): EvalReport {
  const { fullPass, meanScore } = gradeSet(rubric, profilerCases);
  return {
    agent: 'profiler',
    description: `${profilerCases.length} websites: offerings, grounded proof points, sensible ICP`,
    cases: profilerCases.length,
    metrics: [
      metric('rubric full-pass rate', fullPass, 0.9, {
        note: `${Math.round(fullPass * profilerCases.length)}/${profilerCases.length} profiles`,
      }),
      metric('mean rubric score', meanScore, 0.9),
    ],
  };
}
