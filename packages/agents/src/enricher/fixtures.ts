import type { CompanyResearch } from '@sutra/domain';

/**
 * Canned per-company research for tests and demo mode, keyed by domain. Every signal cites a
 * `.example` URL (reserved TLD), so the acceptance rule "every research signal links to a real URL"
 * holds without any network call.
 */
export const enricherFixtures: Record<string, CompanyResearch> = {
  'kopinusantara.example': {
    summary:
      'Kopi Nusantara runs a growing chain of specialty coffee outlets across Jakarta and is expanding into Bandung.',
    signals: [
      {
        kind: 'expansion',
        text: 'Opened a new outlet in Bandung in Q3',
        sourceUrl: 'https://kopinusantara.example/news/bandung',
        date: '2026-08',
      },
      {
        kind: 'hiring',
        text: 'Hiring outlet managers and baristas across Java',
        sourceUrl: 'https://careers.example/kopi-nusantara',
      },
    ],
    matchedIcpSignals: ['opened a new outlet'],
    websiteLanguage: 'id',
    sources: ['https://kopinusantara.example', 'https://directory.example/kopi-nusantara'],
  },
  'kayatoastclub.example': {
    summary:
      'Kaya Toast Club is a Singapore heritage-café brand with several outlets and a new delivery menu.',
    signals: [
      {
        kind: 'launch',
        text: 'Launched an islandwide delivery menu',
        sourceUrl: 'https://kayatoastclub.example/delivery',
      },
    ],
    matchedIcpSignals: ['launched a delivery menu'],
    websiteLanguage: 'en',
    sources: ['https://kayatoastclub.example'],
  },
  'lioncitybakes.example': {
    summary: 'Lion City Bakes is a Singapore bakery group opening new neighbourhood outlets.',
    signals: [
      {
        kind: 'expansion',
        text: 'Opened a new outlet in Tampines',
        sourceUrl: 'https://lioncitybakes.example/stores',
      },
    ],
    matchedIcpSignals: ['opened a new outlet'],
    websiteLanguage: 'en',
    sources: ['https://lioncitybakes.example', 'https://data.gov.sg'],
  },
  'phosaigonhouse.example': {
    summary:
      'Pho Saigon House is a Vietnamese restaurant group scaling outlets in Ho Chi Minh City.',
    signals: [
      {
        kind: 'expansion',
        text: 'Opened a third outlet in District 1',
        sourceUrl: 'https://phosaigonhouse.example/tin-tuc',
      },
    ],
    matchedIcpSignals: ['opened a new outlet'],
    websiteLanguage: 'vi',
    sources: ['https://phosaigonhouse.example'],
  },
};
