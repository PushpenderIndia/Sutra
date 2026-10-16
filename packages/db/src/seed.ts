import type { CampaignStep, ContactStatus, Country, Id, Locale, ReplyIntent } from '@sutra/domain';
import { ObjectId } from 'mongodb';
import { variantHash } from './approval.ts';
import { db } from './client.ts';
import {
  AuditEvents,
  BusinessProfiles,
  Campaigns,
  Companies,
  Consents,
  Contacts,
  Enrollments,
  Icps,
  Meetings,
  Messages,
  PipelineNodes,
  PipelineRuns,
  Replies,
  repositories,
  Suppressions,
  TrackingEvents,
  WorkspaceSettings,
} from './collections.ts';
import { newId } from './repository.ts';

/** Fixed id ("demo" in hex) so `pnpm db:seed --demo` always resets the same workspace. */
export const DEMO_WORKSPACE_ID = '64656d6f0000000000000001';

const DAY = 86_400_000;
const LOCALE: Partial<Record<Country, Locale>> = { ID: 'id', VN: 'vi', MY: 'ms', TH: 'th' };
const TZ: Record<string, string> = {
  SG: 'Asia/Singapore',
  ID: 'Asia/Jakarta',
  VN: 'Asia/Ho_Chi_Minh',
  MY: 'Asia/Kuala_Lumpur',
  TH: 'Asia/Bangkok',
};

// All prospects are fictional and use the reserved `.example` TLD, so nothing here is a real address.
const PROSPECTS: [name: string, country: Country, city: string, industry: string][] = [
  ['Kopi Nusantara', 'ID', 'Jakarta', 'Coffee chain'],
  ['Teh Manis Co', 'ID', 'Bandung', 'Beverage chain'],
  ['Roti Pagi', 'ID', 'Surabaya', 'Bakery'],
  ['Sambal Kita', 'ID', 'Jakarta', 'Packaged food'],
  ['Pho Saigon House', 'VN', 'Ho Chi Minh City', 'Restaurant group'],
  ['Banh Mi Lane', 'VN', 'Hanoi', 'Quick-service restaurant'],
  ['Ca Phe Moc', 'VN', 'Da Nang', 'Coffee chain'],
  ['Lion City Bakes', 'SG', 'Singapore', 'Bakery'],
  ['Kaya Toast Club', 'SG', 'Singapore', 'Cafe chain'],
  ['Hawker Box', 'SG', 'Singapore', 'Packaged food'],
  ['Teh Tarik Bros', 'MY', 'Kuala Lumpur', 'Beverage chain'],
  ['Nasi Lemak Express', 'MY', 'Penang', 'Quick-service restaurant'],
  ['Bangkok Bites', 'TH', 'Bangkok', 'Restaurant group'],
  ['Cha Yen Corner', 'TH', 'Chiang Mai', 'Beverage chain'],
  ['Mango Sticky Co', 'TH', 'Bangkok', 'Dessert chain'],
  ['Island Juice Bar', 'ID', 'Denpasar', 'Beverage chain'],
];
const PEOPLE: [first: string, last: string, title: string, persona: string][] = [
  ['Ayu', 'Pratama', 'Head of Operations', 'Head of Operations'],
  ['Linh', 'Nguyen', 'Marketing Manager', 'Brand Marketing Manager'],
];

/** Mulberry32: deterministic, so the demo looks the same after every reset. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Resets the demo workspace to a realistic mid-campaign state: a confirmed profile and ICP,
 * scored prospects, a running A/B campaign with a week of sends, opens, clicks, replies and
 * meetings, and an optimizer challenger awaiting approval. The workspace is a Better Auth
 * organization; pass `ownerEmail` (a user who has signed in once) to make them its owner.
 */
export async function seedDemo({ now = new Date(), ownerEmail }: SeedOptions = {}) {
  const ws: Id = DEMO_WORKSPACE_ID;
  const owner = await linkDemoOrganization(now, ownerEmail);
  const random = rng(42);
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  await Promise.all(
    repositories.map((r) => db().collection(r.name).deleteMany({ workspaceId: ws })),
  );

  await WorkspaceSettings.create(ws, {
    website: 'https://pixelpress.sg',
    senderName: 'Mei Tan',
    senderTitle: 'Partnerships Lead',
    signature: 'Mei Tan · PixelPress',
    physicalAddress: '1 Demo Street, #01-01, Singapore 000001',
    homeCountry: 'SG',
    timezone: 'Asia/Singapore',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });

  const site = 'https://pixelpress.sg';
  await BusinessProfiles.create(ws, {
    status: 'confirmed',
    version: 1,
    name: 'PixelPress',
    website: site,
    oneLiner: 'Custom packaging and print for food and beverage brands across Southeast Asia.',
    offerings: [
      {
        name: 'Branded cups and sleeves',
        description: 'Short-run printed cups, sleeves and lids.',
      },
      { name: 'Takeaway packaging', description: 'Boxes, bags and labels with fast reorders.' },
      {
        name: 'Design studio',
        description: 'In-house packaging design.',
        pricingHint: 'Free with first order',
      },
    ],
    proofPoints: [
      { text: 'Ships in 7 days across 5 countries', sourceUrl: `${site}/about` },
      { text: '120+ F&B brands served', sourceUrl: `${site}/customers` },
    ],
    customers: [
      { name: 'Sunrise Coffee', domain: 'sunrisecoffee.example', sourceUrl: `${site}/customers` },
      { name: 'Green Bowl', domain: 'greenbowl.example', sourceUrl: `${site}/customers` },
    ],
    geographies: ['SG', 'ID', 'VN', 'MY', 'TH'],
    differentiators: ['Minimum order of 500 units', 'Recycled and compostable stock'],
    competitors: [{ name: 'Generic Print Co', domain: 'genericprint.example' }],
    toneOfVoice: 'Friendly, practical and concise.',
    sources: [site, `${site}/about`],
  });
  await Icps.create(ws, {
    status: 'confirmed',
    version: 1,
    firmographics: {
      industries: ['Coffee chain', 'Beverage chain', 'Bakery', 'Restaurant group', 'Packaged food'],
      sizes: ['11-50', '51-200', '201-1000'],
      countries: ['ID', 'VN', 'SG', 'MY', 'TH'],
      keywords: ['outlets', 'takeaway', 'delivery'],
      technologies: [],
    },
    personas: PEOPLE.map(([, , , title]) => ({
      title,
      altTitles: [],
      seniority: 'manager' as const,
      pains: ['Slow packaging reorders', 'High minimum order quantities'],
      goals: ['Consistent branding across outlets'],
      objections: ['We already have a supplier'],
    })),
    buyingSignals: ['opened a new outlet', 'launched a delivery menu'],
    disqualifiers: ['enterprise procurement only'],
    rationale: 'Existing customers are multi-outlet F&B brands in SEA that reorder often.',
  });

  const companies = await Companies.createMany(
    ws,
    PROSPECTS.map(([name, country, city, industry], i) => {
      const domain = `${slug(name)}.example`;
      const score = 92 - i * 3;
      return {
        name,
        normalizedName: name.toLowerCase(),
        domain,
        website: `https://${domain}`,
        country,
        city,
        timezone: TZ[country],
        industry,
        size: i % 3 === 0 ? ('51-200' as const) : ('11-50' as const),
        sources: [
          { source: 'search' as const, ref: `${industry} in ${city}`, at: at(9) },
          ...(i % 2
            ? [
                {
                  source: 'lookalike' as const,
                  ref: 'Sunrise Coffee',
                  at: at(9),
                  resembles: 'Sunrise Coffee',
                },
              ]
            : []),
        ],
        research: {
          summary: `${name} runs several ${industry.toLowerCase()} outlets in ${city}.`,
          signals: [
            {
              kind: 'expansion' as const,
              text: 'Opened a new outlet',
              sourceUrl: `https://${domain}/news`,
            },
          ],
          matchedIcpSignals: ['opened a new outlet'],
          sources: [`https://${domain}`],
        },
        researchedAt: at(8),
        score,
        fit: score >= 75 ? ('strong' as const) : ('medium' as const),
        scoreReasons: [{ text: `${industry} in a target country`, weight: 0.4, evidence: city }],
        status: 'scored' as const,
      };
    }),
  );

  const contacts = await Contacts.createMany(
    ws,
    companies.flatMap((c, i) =>
      PEOPLE.map(([first, last, title, persona], j) => ({
        companyId: c._id,
        name: `${first} ${last}`,
        firstName: first,
        title,
        email: `${(j ? `${first}.${last}` : first).toLowerCase()}@${c.domain}`,
        emailConfidence: (i + j) % 3 ? ('pattern' as const) : ('verified' as const),
        source: 'search' as const,
        personaMatch: persona,
        locale: LOCALE[c.country] ?? 'en',
        timezone: c.timezone ?? 'Asia/Singapore',
        status: 'contacted' as const,
      })),
    ),
  );
  await Consents.createMany(
    ws,
    contacts.map((c) => ({
      contactId: c._id,
      basis: 'legitimate_interest' as const,
      source: 'public_page',
      evidence: `https://${c.email.split('@')[1]}/contact`,
      at: at(8),
    })),
  );
  await Suppressions.create(ws, {
    kind: 'opt_out',
    scope: 'domain',
    value: 'donotcontact.example',
    reason: 'Asked not to be contacted',
    at: at(20),
  });

  const v = (
    status: 'active' | 'pending_approval',
    dimension: 'subject' | 'hook' | 'cta',
    hypothesis: string,
    subject: string,
    body: string,
    extra: { origin?: 'optimizer'; parentId?: Id } = {},
  ) => ({
    id: newId(),
    status,
    origin: 'initial' as const,
    dimension,
    hypothesis,
    subject,
    body,
    ...(status === 'active' && {
      approvedHash: variantHash({ subject, body }),
      approvedBy: 'demo-user',
      approvedAt: at(8),
    }),
    ...extra,
  });
  const intro = 'Hi {{firstName}},\n\n{{personalization}}\n\n';
  const steps: CampaignStep[] = [
    {
      delayDays: 0,
      intent: 'intro',
      angle: 'Faster packaging reorders for growing outlets',
      variants: [
        v(
          'active',
          'subject',
          'A statement subject sets clear expectations',
          'Packaging for {{company}}',
          `${intro}We print cups and takeaway packaging for F&B brands, from 500 units, in 7 days.\n\nWorth a quick chat?\n\n{{senderName}}`,
        ),
        v(
          'active',
          'subject',
          'A question subject earns more replies',
          'Running low on cups at {{company}}?',
          `${intro}We print cups and takeaway packaging for F&B brands, from 500 units, in 7 days.\n\nWorth a quick chat?\n\n{{senderName}}`,
        ),
      ],
    },
    {
      delayDays: 3,
      intent: 'social_proof',
      angle: '120+ F&B brands reorder with us',
      variants: [
        v(
          'active',
          'hook',
          'Leading with a number is more credible',
          'Re: Packaging for {{company}}',
          `${intro}120+ F&B brands across SEA reorder packaging with us every month.\n\n{{senderName}}`,
        ),
        v(
          'active',
          'hook',
          'Leading with a peer story is more relatable',
          'Re: Packaging for {{company}}',
          `${intro}Sunrise Coffee cut reorder time from 4 weeks to 7 days with us.\n\n{{senderName}}`,
        ),
      ],
    },
    {
      delayDays: 5,
      intent: 'breakup',
      angle: 'Close the loop politely',
      variants: [
        v(
          'active',
          'cta',
          'A low-effort CTA gets a final response',
          'Close the loop?',
          `${intro}Should I send a sample pack, or is now not the right time?\n\n{{senderName}}`,
        ),
      ],
    },
  ];
  const [stepA, stepB] = steps[0]?.variants ?? [];
  if (stepA && stepB) {
    steps[0]?.variants.push(
      v(
        'pending_approval',
        'cta',
        'Offering samples beats asking for a call',
        'Running low on cups at {{company}}?',
        `${intro}We print cups and takeaway packaging for F&B brands, from 500 units, in 7 days.\n\nShall I send a free sample pack?\n\n{{senderName}}`,
        { origin: 'optimizer', parentId: stepB.id },
      ),
    );
  }
  const campaign = await Campaigns.create(ws, {
    name: 'F&B operations leads — SEA',
    icpVersion: 1,
    persona: 'Head of Operations',
    steps,
    status: 'running',
    approvedBy: 'demo-user',
    approvedAt: at(8),
  });

  // Simulate a week of sends. Variant B (the question subject) truly converts about 2× better.
  const replyRate: Record<string, number> = { [stepA?.id ?? '']: 0.08, [stepB?.id ?? '']: 0.18 };
  const outcome = {
    interested: 'interested',
    meeting_request: 'interested',
    question: 'interested',
    not_now: 'not_now',
    not_interested: 'not_interested',
  } as const satisfies Partial<Record<ReplyIntent, ContactStatus>>;
  const intents = Object.keys(outcome) as (keyof typeof outcome)[];
  const companyOf = new Map(companies.map((c) => [c._id, c]));
  let meetings = 0;

  for (const [n, contact] of contacts.entries()) {
    const enrollmentId = newId();
    const assigned: Record<string, Id> = {};
    let replied: keyof typeof outcome | undefined;
    let stepIndex = 0;
    for (const [s, step] of steps.entries()) {
      const active = step.variants.filter((x) => x.status === 'active');
      const variant = active[Math.floor(random() * active.length)];
      if (!variant) break;
      const day = 7 - steps.slice(0, s + 1).reduce((d, x) => d + x.delayDays, 0);
      assigned[s] = variant.id;
      stepIndex = s;
      const name = companyOf.get(contact.companyId)?.name ?? '';
      const sent = await Messages.create(ws, {
        contactId: contact._id,
        campaignId: campaign._id,
        enrollmentId,
        stepIndex: s,
        direction: 'outbound',
        variantId: variant.id,
        status: 'sent',
        to: contact.email,
        subject: variant.subject.replace('{{company}}', name),
        body: variant.body.replace('{{firstName}}', contact.firstName ?? ''),
        threadId: `demo-thread-${n}`,
        idempotencyKey: `demo:${enrollmentId}:${s}`,
        sentAt: at(day),
      });
      const events = [
        ...(random() < 0.3 ? [{ kind: 'open' as const, machine: true }] : []),
        ...(random() < 0.45 ? [{ kind: 'open' as const, machine: false }] : []),
        ...(random() < 0.12
          ? [{ kind: 'click' as const, machine: false, url: `${site}/samples` }]
          : []),
      ];
      await TrackingEvents.createMany(
        ws,
        events.map((e) => ({
          ...e,
          messageId: sent._id,
          variantId: variant.id,
          at: at(day - 0.1),
        })),
      );
      if (random() < (replyRate[variant.id] ?? 0.1)) {
        replied = intents[Math.floor(random() * intents.length)] ?? 'interested';
        const inbound = await Messages.create(ws, {
          contactId: contact._id,
          campaignId: campaign._id,
          enrollmentId,
          stepIndex: s,
          direction: 'inbound',
          status: 'received',
          from: contact.email,
          subject: `Re: ${sent.subject}`,
          body: replied === 'not_interested' ? 'No thanks.' : 'Sounds interesting, tell me more.',
          threadId: sent.threadId,
          idempotencyKey: `demo:reply:${enrollmentId}`,
        });
        await Replies.create(ws, {
          messageId: inbound._id,
          contactId: contact._id,
          campaignId: campaign._id,
          stepIndex: s,
          variantId: variant.id,
          intent: replied,
          sentiment: replied === 'not_interested' ? 'negative' : 'positive',
          language: contact.locale,
          summaryEn: replied === 'not_interested' ? 'Not interested.' : 'Wants to learn more.',
          at: at(day - 0.5),
        });
        break;
      }
    }
    const booked = (replied === 'interested' || replied === 'meeting_request') && meetings < 2;
    if (booked) {
      meetings++;
      const startsAt = new Date(
        Math.ceil(now.getTime() / DAY) * DAY + (2 + meetings) * DAY + 3 * 3_600_000,
      );
      await Meetings.create(ws, {
        contactId: contact._id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        timezone: contact.timezone,
        calendarEventId: `demo-event-${meetings}`,
        meetUrl: `https://meet.google.com/demo-${meetings}`,
      });
    }
    const status = booked ? 'meeting_booked' : replied ? outcome[replied] : 'contacted';
    await Contacts.update(ws, contact._id, { status });
    await Enrollments.col().insertOne(
      Enrollments.schema.parse({
        _id: enrollmentId,
        workspaceId: ws,
        createdAt: at(7),
        updatedAt: now,
        contactId: contact._id,
        campaignId: campaign._id,
        stepIndex,
        assignedVariants: assigned,
        ...(replied
          ? { status: 'stopped', stopReason: booked ? 'meeting_booked' : 'replied' }
          : stepIndex === steps.length - 1
            ? { status: 'completed', stopReason: 'campaign_done' }
            : { status: 'active', nextRunAt: new Date(now.getTime() + DAY) }),
      }),
    );
  }

  const run = await PipelineRuns.create(ws, { status: 'done', startedAt: at(9), endedAt: at(7) });
  const nodes = [
    'profiler',
    'checkpoint1',
    'prospector',
    'enricher',
    'copywriter',
    'checkpoint2',
    'sender',
  ];
  await PipelineNodes.createMany(
    ws,
    nodes.map((nodeId, i) => ({
      runId: run._id,
      nodeId,
      parentId: 'orchestrator',
      agent: nodeId,
      status: 'done' as const,
      summary: `${nodeId} done`,
      startedAt: at(9 - i * 0.3),
      endedAt: at(8.9 - i * 0.3),
    })),
  );
  await AuditEvents.create(ws, {
    actor: { kind: 'user', id: 'demo-user' },
    action: 'campaign.approve',
    entity: 'campaigns',
    entityId: campaign._id,
    at: at(8),
  });

  return {
    workspaceId: ws,
    owner,
    companies: companies.length,
    contacts: contacts.length,
    meetings,
  };
}

export type SeedOptions = { now?: Date; ownerEmail?: string };

/** Upserts the demo workspace's Better Auth `organization` (and owner `member`) rows. */
async function linkDemoOrganization(now: Date, ownerEmail?: string) {
  const organizationId = new ObjectId(DEMO_WORKSPACE_ID);
  await db()
    .collection('organization')
    .updateOne(
      { _id: organizationId },
      {
        $set: { name: 'PixelPress (demo)', slug: 'pixelpress-demo' },
        $setOnInsert: { createdAt: now, metadata: JSON.stringify({ demo: true }) },
      },
      { upsert: true },
    );
  if (!ownerEmail) return undefined;
  const user = await db().collection('user').findOne({ email: ownerEmail.toLowerCase() });
  if (!user) throw new Error(`No user ${ownerEmail}: sign in once, then re-run the seed`);
  await db()
    .collection('member')
    .updateOne(
      { organizationId, userId: user._id },
      { $set: { role: 'owner' }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  return ownerEmail;
}
