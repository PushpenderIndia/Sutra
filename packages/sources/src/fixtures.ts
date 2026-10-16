import type { Country } from '@sutra/domain';
import type { ApolloPerson, CompanyHit, HunterContact, PlaceResult } from './clients.ts';

/**
 * A fixed pool of fictional companies (reserved `.example` TLD, plus the profiler's own fixture
 * domains so the fake crawler has pages for contact discovery). Used by the fake company-search,
 * so `search` and `lookalike` return overlapping, de-dupable results for tests and demo mode.
 */
export const companyPool: CompanyHit[] = [
  {
    name: 'Kopi Nusantara',
    domain: 'kopinusantara.example',
    website: 'https://kopinusantara.example',
    country: 'ID',
    city: 'Jakarta',
    industry: 'Coffee chain',
    size: '51-200',
    description: 'A fast-growing coffee chain with outlets across Jakarta.',
    sourceUrl: 'https://directory.example/kopi-nusantara',
  },
  {
    name: 'Kaya Toast Club',
    domain: 'kayatoastclub.example',
    website: 'https://kayatoastclub.example',
    country: 'SG',
    city: 'Singapore',
    industry: 'Coffee chain',
    size: '11-50',
    description: 'A kaya-toast and coffee cafe chain in Singapore.',
    sourceUrl: 'https://directory.example/kaya-toast-club',
  },
  {
    name: 'Lion City Bakes',
    domain: 'lioncitybakes.example',
    website: 'https://lioncitybakes.example',
    country: 'SG',
    city: 'Singapore',
    industry: 'Bakery',
    size: '11-50',
    description: 'A neighbourhood bakery group in Singapore.',
    sourceUrl: 'https://directory.example/lion-city-bakes',
  },
  {
    name: 'Pho Saigon House',
    domain: 'phosaigonhouse.example',
    website: 'https://phosaigonhouse.example',
    country: 'VN',
    city: 'Ho Chi Minh City',
    industry: 'Restaurant group',
    size: '51-200',
    description: 'A restaurant group serving pho across southern Vietnam.',
    sourceUrl: 'https://directory.example/pho-saigon-house',
  },
  {
    name: 'Teh Tarik Bros',
    domain: 'tehtarikbros.example',
    website: 'https://tehtarikbros.example',
    country: 'MY',
    city: 'Kuala Lumpur',
    industry: 'Beverage chain',
    size: '11-50',
    description: 'A beverage chain famous for teh tarik in Malaysia.',
    sourceUrl: 'https://directory.example/teh-tarik-bros',
  },
  {
    name: 'FreshCrate',
    domain: 'freshcrate.com',
    website: 'https://freshcrate.com',
    country: 'SG',
    city: 'Singapore',
    industry: 'Packaged food',
    size: '11-50',
    description: 'Wholesale produce supplier to restaurants and cafes.',
    sourceUrl: 'https://directory.example/freshcrate',
  },
  {
    name: 'CargoWing',
    domain: 'cargowing.com',
    website: 'https://cargowing.com',
    country: 'VN',
    city: 'Ho Chi Minh City',
    industry: 'Logistics',
    size: '201-1000',
    description: 'Cross-border freight forwarder across Southeast Asia.',
    sourceUrl: 'https://directory.example/cargowing',
  },
  {
    name: 'Flowbase',
    domain: 'flowbase.io',
    website: 'https://flowbase.io',
    country: 'SG',
    city: 'Singapore',
    industry: 'Software',
    size: '51-200',
    description: 'Workflow automation for operations teams.',
    sourceUrl: 'https://directory.example/flowbase',
  },
];

/** Local-business results for the fake Places client (F&B, de-dupable with the search pool). */
export const placePool: PlaceResult[] = [
  {
    name: 'Kaya Toast Club',
    website: 'https://kayatoastclub.example',
    city: 'Singapore',
    country: 'SG',
    address: '1 Cafe Lane, Singapore',
    placeId: 'place-kaya-toast-club',
  },
  {
    name: 'Lion City Bakes',
    website: 'https://lioncitybakes.example',
    city: 'Singapore',
    country: 'SG',
    address: '2 Bakery Road, Singapore',
    placeId: 'place-lion-city-bakes',
  },
  {
    name: 'Island Juice Bar',
    website: 'https://islandjuicebar.example',
    city: 'Denpasar',
    country: 'ID',
    address: '3 Beach Street, Denpasar',
    placeId: 'place-island-juice-bar',
  },
];

/** Singapore open-registry results for the fake registry client. */
export const registryPool: Partial<Record<Country, CompanyHit[]>> = {
  SG: [
    {
      name: 'Lion City Bakes',
      domain: 'lioncitybakes.example',
      website: 'https://lioncitybakes.example',
      country: 'SG',
      city: 'Singapore',
      industry: 'Bakery',
      sourceUrl: 'https://data.gov.sg/dataset/acra',
    },
    {
      name: 'Hawker Box',
      domain: 'hawkerbox.example',
      website: 'https://hawkerbox.example',
      country: 'SG',
      city: 'Singapore',
      industry: 'Packaged food',
      sourceUrl: 'https://data.gov.sg/dataset/acra',
    },
  ],
};

/** Fake Apollo people (paid source; only used in tests with the flag and a key). */
export const apolloPool: ApolloPerson[] = [
  {
    name: 'Mei Lin',
    title: 'Head of Operations',
    email: 'mei.lin@kopinusantara.example',
    company: companyPool[0] as CompanyHit,
  },
];

/** Fake Hunter contacts by domain (paid source). */
export const hunterPool: Record<string, HunterContact[]> = {
  'kopinusantara.example': [
    {
      name: 'Ayu Pratama',
      title: 'Operations Manager',
      email: 'ayu@kopinusantara.example',
      confidence: 90,
    },
  ],
};
