import type { Source } from '@sutra/domain';
import { apolloSource } from './sources/apollo.ts';
import { csvSource } from './sources/csv.ts';
import { hunterSource } from './sources/hunter.ts';
import { lookalikeSource } from './sources/lookalike.ts';
import { placesSource } from './sources/places.ts';
import { registrySource } from './sources/registry.ts';
import { searchSource } from './sources/search.ts';
import type { LeadSource, SourceContext } from './types.ts';

/** Every lead source, free ones first (the order the prospector fans out in). */
export const leadSources: readonly LeadSource[] = [
  searchSource,
  lookalikeSource,
  placesSource,
  registrySource,
  csvSource,
  apolloSource,
  hunterSource,
];

export const leadSourceById: ReadonlyMap<Source, LeadSource> = new Map(
  leadSources.map((s) => [s.id, s]),
);

/** The sources that may run for a context (flags, workspace toggles, credentials, ICP fit). */
export const enabledLeadSources = (ctx: SourceContext): LeadSource[] =>
  leadSources.filter((s) => s.enabled(ctx));

export * from './clients.ts';
export * from './collect.ts';
export * from './email.ts';
export * from './fixtures.ts';
export * from './geo.ts';
export * from './normalize.ts';
export * from './persona.ts';
export * from './sources/apollo.ts';
export * from './sources/csv.ts';
export * from './sources/hunter.ts';
export * from './sources/lookalike.ts';
export * from './sources/places.ts';
export * from './sources/registry.ts';
export * from './sources/search.ts';
export * from './types.ts';
export * from './verify.ts';
