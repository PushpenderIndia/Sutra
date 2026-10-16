import type {
  PersonalizationLine,
  SequencePlan,
  VariantPair,
  VariantTranslation,
} from '@sutra/domain';

/**
 * Canned copywriter outputs for tests and demo mode, so the whole node runs with no network. Each
 * template uses only the allowed merge fields and passes the deterministic quality gate; the
 * personalisation fixture cites a `.example` URL that appears in the enricher research fixtures.
 */
export const sequencePlanFixture: SequencePlan = {
  steps: [
    { delayDays: 0, intent: 'intro', angle: 'Faster packaging reorders for growing outlets' },
    { delayDays: 3, intent: 'social_proof', angle: 'F&B brands reorder with us every month' },
    { delayDays: 5, intent: 'breakup', angle: 'Close the loop politely' },
  ],
  rationale:
    'Operations leads feel reorder lead times; open on the pain, prove it with peers, then close.',
};

const intro = 'Hi {{firstName}},\n\n{{personalization}}\n\n';
const signoff = '\n\n{{senderName}}';

/** Two variants per step, each pair differing in exactly one declared dimension. */
export const variantPairFixtures: VariantPair[] = [
  {
    variants: [
      {
        hypothesis: 'A statement subject sets clear expectations',
        dimension: 'subject',
        subject: 'Packaging for {{company}}',
        body: `${intro}We print cups and takeaway packaging for F&B brands, from 500 units, in 7 days. Worth a quick chat?${signoff}`,
      },
      {
        hypothesis: 'A question subject earns more replies',
        dimension: 'subject',
        subject: 'Running low on cups at {{company}}?',
        body: `${intro}We print cups and takeaway packaging for F&B brands, from 500 units, in 7 days. Worth a quick chat?${signoff}`,
      },
    ],
  },
  {
    variants: [
      {
        hypothesis: 'Leading with a number is more credible',
        dimension: 'hook',
        subject: 'Re: Packaging for {{company}}',
        body: `${intro}Over a hundred F&B brands across the region reorder packaging with us every month. Happy to share how.${signoff}`,
      },
      {
        hypothesis: 'Leading with a peer story is more relatable',
        dimension: 'hook',
        subject: 'Re: Packaging for {{company}}',
        body: `${intro}A nearby coffee group cut reorder time from four weeks to seven days with us. Worth a look?${signoff}`,
      },
    ],
  },
  {
    variants: [
      {
        hypothesis: 'A low-effort CTA gets a final response',
        dimension: 'cta',
        subject: 'Close the loop at {{company}}?',
        body: `${intro}Should I send a sample pack, or is now not the right time?${signoff}`,
      },
      {
        hypothesis: 'A deadline-free CTA feels lower pressure',
        dimension: 'cta',
        subject: 'Close the loop at {{company}}?',
        body: `${intro}Happy to leave this with you — just let me know if packaging ever gets tight.${signoff}`,
      },
    ],
  },
];

/** A Bahasa Indonesia rendering of the first intro variant, merge fields preserved. */
export const translationFixtures: Record<string, VariantTranslation> = {
  id: {
    subject: 'Kemasan untuk {{company}}',
    body: 'Halo {{firstName}},\n\n{{personalization}}\n\nKami mencetak gelas dan kemasan bawa-pulang untuk brand F&B, mulai dari 500 unit, dalam 7 hari. Bapak/Ibu ada waktu untuk ngobrol singkat?\n\n{{senderName}}',
  },
};

/** A grounded personalisation line citing a URL from the enricher research fixtures. */
export const personalizationFixture: PersonalizationLine = {
  line: 'Selamat atas pembukaan outlet baru di Bandung — ekspansi yang cepat untuk sebuah jaringan kopi.',
  sourceUrl: 'https://kopinusantara.example/news/bandung',
};
