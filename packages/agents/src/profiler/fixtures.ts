import type { WebResearchResult } from '@sutra/domain';

/**
 * Five real-world-style sites (SaaS, agency, logistics, F&B supplier, edtech) used by the fake
 * crawler for tests, evals and demo mode. Each homepage links to its sub-pages so the ranker
 * has something to pick, and carries a customer logo wall.
 */

type Fixture = { robotsTxt?: string; pages: Record<string, string> };

const page = (opts: {
  title: string;
  description: string;
  nav?: string[];
  heading: string;
  body: string;
  logos?: string[];
}) => {
  const nav = (opts.nav ?? [])
    .map((href) => `<a href="${href}">${href.replace(/[/-]/g, ' ').trim()}</a>`)
    .join('\n');
  const logos = (opts.logos ?? [])
    .map((alt) => `<img class="customer-logo" src="/logos/${alt}.png" alt="${alt}" />`)
    .join('\n');
  return `<!doctype html><html lang="en"><head>
<title>${opts.title}</title>
<meta name="description" content="${opts.description}" />
<meta property="og:title" content="${opts.title}" />
</head><body>
<nav>${nav}</nav>
<main><h1>${opts.heading}</h1><p>${opts.body}</p></main>
<section aria-label="Customers">${logos}</section>
</body></html>`;
};

const SITE_PATHS = ['/about', '/products', '/pricing', '/customers', '/blog/launch', '/contact'];

export const profilerFixtures: Record<string, Fixture> = {
  'flowbase.io': {
    robotsTxt: 'User-agent: *\nDisallow: /admin\n',
    pages: {
      '/': page({
        title: 'Flowbase — Workflow automation for ops teams',
        description:
          'Flowbase automates repetitive back-office workflows for finance and operations teams.',
        nav: [...SITE_PATHS, '/admin'],
        heading: 'Automate the busywork your ops team hates',
        body: 'Flowbase is a no-code workflow platform that connects your spreadsheets, inboxes and internal tools so finance and operations teams stop copying data by hand. Build an approval flow in minutes and ship it to the whole company.',
        logos: ['Northstar Bank', 'Harbour Logistics', 'Meadow Foods'],
      }),
      '/products': page({
        title: 'Product — Flowbase',
        description: 'Builder, connectors and audit log.',
        heading: 'One builder, hundreds of connectors',
        body: 'Design flows with a drag-and-drop builder, connect over 300 apps, and keep a full audit log of every run. Role-based access and SOC 2 controls are built in for regulated teams.',
      }),
      '/pricing': page({
        title: 'Pricing — Flowbase',
        description: 'Simple per-seat pricing.',
        heading: 'Plans that scale with your team',
        body: 'Start free for up to three editors. The Team plan is $20 per editor per month and the Business plan adds SSO, advanced audit and priority support for larger operations departments.',
      }),
      '/customers': page({
        title: 'Customers — Flowbase',
        description: 'Teams that run on Flowbase.',
        heading: 'Trusted by operations teams',
        body: 'Northstar Bank cut invoice approvals from five days to one. Harbour Logistics automated 40 handover checklists. Meadow Foods onboards new outlets in a single afternoon.',
        logos: ['Northstar Bank', 'Harbour Logistics', 'Meadow Foods', 'Cedar Retail'],
      }),
      '/about': page({
        title: 'About — Flowbase',
        description: 'Why we built Flowbase.',
        heading: 'We believe ops teams deserve good tools',
        body: 'Founded in Singapore in 2021, Flowbase now serves more than 400 companies across Southeast Asia and Australia. The team has shipped automation software for a decade.',
      }),
      '/blog/launch': page({
        title: 'Launching Flowbase 2.0 — Flowbase Blog',
        description: 'What is new in 2.0.',
        heading: 'Flowbase 2.0 is here',
        body: 'Our latest release adds a revamped builder, faster runs and a library of templates for finance and operations teams. Read on for the highlights and how to upgrade.',
      }),
      '/contact': page({
        title: 'Contact — Flowbase',
        description: 'Talk to sales.',
        heading: 'Get in touch',
        body: 'Book a demo with our team or email sales to talk through your operations workflows. We reply within one business day.',
      }),
    },
  },
  'northlightstudio.com': {
    pages: {
      '/': page({
        title: 'Northlight — Brand & web studio',
        description: 'Northlight is a brand and web design studio for ambitious consumer startups.',
        nav: ['/about', '/services', '/customers', '/contact'],
        heading: 'Brands people remember',
        body: 'Northlight is a design studio that builds brand identities, websites and launch campaigns for consumer startups. We pair strategy with craft so early-stage founders look like category leaders.',
        logos: ['Bloom', 'Kettle & Co', 'Tiderunner'],
      }),
      '/services': page({
        title: 'Services — Northlight',
        description: 'Brand, web and campaigns.',
        heading: 'What we do',
        body: 'We offer brand identity sprints, Webflow sites and go-to-market campaign design. Most engagements run four to eight weeks with a fixed price agreed up front.',
      }),
      '/customers': page({
        title: 'Work — Northlight',
        description: 'Selected client work.',
        heading: 'Selected work',
        body: 'We rebranded Bloom ahead of its seed round, shipped a new store for Kettle & Co, and ran the launch campaign for Tiderunner across three cities.',
        logos: ['Bloom', 'Kettle & Co', 'Tiderunner', 'Pueblo'],
      }),
      '/about': page({
        title: 'About — Northlight',
        description: 'A small senior team.',
        heading: 'A small, senior team',
        body: 'Northlight is a five-person studio based in Melbourne working with founders across Australia and New Zealand since 2018.',
      }),
      '/contact': page({
        title: 'Contact — Northlight',
        description: 'Start a project.',
        heading: 'Start a project',
        body: 'Tell us about your launch and we will send a proposal within a week. We take on a handful of projects each quarter.',
      }),
    },
  },
  'cargowing.com': {
    pages: {
      '/': page({
        title: 'CargoWing — Cross-border freight forwarding',
        description:
          'CargoWing moves air and sea freight across Southeast Asia with real-time tracking.',
        nav: ['/about', '/services', '/customers', '/pricing', '/contact'],
        heading: 'Freight that shows up on time',
        body: 'CargoWing is a freight forwarder handling air, sea and last-mile delivery across Southeast Asia. Importers and manufacturers get live tracking, customs clearance and one invoice for the whole journey.',
        logos: ['Meadow Foods', 'BuildRight', 'Sunrise Electronics'],
      }),
      '/services': page({
        title: 'Services — CargoWing',
        description: 'Air, sea and customs.',
        heading: 'End-to-end logistics',
        body: 'We manage air and sea freight, customs brokerage, warehousing and last-mile delivery. Dedicated coordinators handle exceptions so your shipments keep moving.',
      }),
      '/customers': page({
        title: 'Customers — CargoWing',
        description: 'Who we move for.',
        heading: 'Importers and manufacturers trust us',
        body: 'Meadow Foods imports ingredients weekly from four countries. BuildRight ships construction materials on tight deadlines. Sunrise Electronics clears customs in under a day with CargoWing.',
        logos: ['Meadow Foods', 'BuildRight', 'Sunrise Electronics', 'Harbour Retail'],
      }),
      '/pricing': page({
        title: 'Pricing — CargoWing',
        description: 'Transparent freight quotes.',
        heading: 'Quotes in 24 hours',
        body: 'Share your lanes and volumes and we return an itemised quote within a day, with no hidden surcharges at delivery.',
      }),
      '/about': page({
        title: 'About — CargoWing',
        description: 'A regional forwarder.',
        heading: 'Built for the region',
        body: 'CargoWing was founded in Jakarta in 2016 and operates offices in Indonesia, Vietnam, Malaysia and Singapore.',
      }),
      '/contact': page({
        title: 'Contact — CargoWing',
        description: 'Request a quote.',
        heading: 'Request a quote',
        body: 'Send us your shipping lanes and a coordinator will reply with pricing and transit times within one business day.',
      }),
    },
  },
  'freshcrate.com': {
    pages: {
      '/': page({
        title: 'FreshCrate — Wholesale produce for restaurants',
        description:
          'FreshCrate supplies fresh produce and dry goods to restaurants and cafes, delivered daily.',
        nav: ['/about', '/products', '/customers', '/contact'],
        heading: 'Fresh ingredients, delivered before service',
        body: 'FreshCrate is a wholesale food supplier delivering fresh produce, dairy and dry goods to restaurants, cafes and hotels. Order by midnight and it arrives before the kitchen opens.',
        logos: ['Sunrise Coffee', 'Green Bowl', 'Harbour Bistro'],
      }),
      '/products': page({
        title: 'Products — FreshCrate',
        description: 'Produce, dairy and dry goods.',
        heading: 'A full pantry from one supplier',
        body: 'We stock seasonal produce, dairy, meat and dry goods from vetted farms and importers, with consistent quality and one delivery window each morning.',
      }),
      '/customers': page({
        title: 'Customers — FreshCrate',
        description: 'Kitchens we supply.',
        heading: 'Kitchens that run on FreshCrate',
        body: 'Sunrise Coffee stocks 12 cafes through FreshCrate. Green Bowl gets daily greens for its salad bars. Harbour Bistro trimmed waste by ordering to a tighter schedule.',
        logos: ['Sunrise Coffee', 'Green Bowl', 'Harbour Bistro', 'Lotus Kitchen'],
      }),
      '/about': page({
        title: 'About — FreshCrate',
        description: 'A family supplier.',
        heading: 'A family supplier since 2012',
        body: 'FreshCrate started as a market stall in Singapore and now delivers to hundreds of kitchens across Singapore and Malaysia every morning.',
      }),
      '/contact': page({
        title: 'Contact — FreshCrate',
        description: 'Open an account.',
        heading: 'Open a wholesale account',
        body: 'Tell us your menu and volumes and we will set up standing orders and a morning delivery window that fits your service.',
      }),
    },
  },
  'learnloop.io': {
    pages: {
      '/': page({
        title: 'LearnLoop — Upskilling platform for teams',
        description:
          'LearnLoop helps companies train and certify staff with short, role-based courses.',
        nav: ['/about', '/products', '/pricing', '/customers', '/contact'],
        heading: 'Upskill your whole team',
        body: 'LearnLoop is a learning platform that delivers short, role-based courses and certifications to growing companies. Managers assign tracks, staff learn on mobile, and progress is easy to report.',
        logos: ['Northstar Bank', 'CargoWing', 'Bloom'],
      }),
      '/products': page({
        title: 'Platform — LearnLoop',
        description: 'Courses, tracks and certificates.',
        heading: 'Learning that fits the workday',
        body: 'Build tracks from a library of courses, assign them by role, and issue certificates. Mobile lessons take five minutes and sync offline for frontline teams.',
      }),
      '/pricing': page({
        title: 'Pricing — LearnLoop',
        description: 'Per-learner pricing.',
        heading: 'Pay per active learner',
        body: 'LearnLoop is priced per active learner per month, with volume discounts for companies training more than 200 staff.',
      }),
      '/customers': page({
        title: 'Customers — LearnLoop',
        description: 'Teams learning with us.',
        heading: 'Teams that keep learning',
        body: 'Northstar Bank certifies its branch staff on compliance each quarter. CargoWing onboards warehouse teams in a week. Bloom trains seasonal retail staff before each launch.',
        logos: ['Northstar Bank', 'CargoWing', 'Bloom', 'Meadow Foods'],
      }),
      '/about': page({
        title: 'About — LearnLoop',
        description: 'An edtech for the workplace.',
        heading: 'Learning built for work',
        body: 'LearnLoop was founded in 2020 and supports workplace learning for companies across Australia, Singapore and the Philippines.',
      }),
      '/contact': page({
        title: 'Contact — LearnLoop',
        description: 'Book a walkthrough.',
        heading: 'Book a walkthrough',
        body: 'See how LearnLoop would fit your onboarding and compliance training. We will tailor a demo to your roles.',
      }),
    },
  },
};

/** Canned web-research findings per fixture domain (every fact keeps a real-looking source URL). */
export const fixtureResearch: Record<string, WebResearchResult> = {
  'flowbase.io': {
    findings: [
      {
        text: 'Flowbase raises $6M Series A to automate ops workflows',
        sourceUrl: 'https://techpress.example/flowbase-series-a',
      },
      {
        text: 'Flowbase named a top no-code tool for finance teams',
        sourceUrl: 'https://opsreview.example/best-no-code-2024',
      },
    ],
    queries: ['Flowbase funding', 'Flowbase reviews'],
  },
  'northlightstudio.com': {
    findings: [
      {
        text: 'Northlight wins regional brand design award',
        sourceUrl: 'https://designwire.example/northlight-award',
      },
    ],
    queries: ['Northlight studio reviews'],
  },
  'cargowing.com': {
    findings: [
      {
        text: 'CargoWing opens new Vietnam customs office',
        sourceUrl: 'https://logisticsdaily.example/cargowing-vietnam',
      },
    ],
    queries: ['CargoWing freight news'],
  },
  'freshcrate.com': {
    findings: [
      {
        text: 'FreshCrate expands morning delivery to Johor',
        sourceUrl: 'https://fnbtimes.example/freshcrate-johor',
      },
    ],
    queries: ['FreshCrate wholesale produce'],
  },
  'learnloop.io': {
    findings: [
      {
        text: 'LearnLoop partners with bank to certify branch staff',
        sourceUrl: 'https://edtechwatch.example/learnloop-bank',
      },
    ],
    queries: ['LearnLoop edtech news'],
  },
};
