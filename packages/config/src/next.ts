import { loadSource } from './load.ts';

/** `NEXT_PUBLIC_*` values from the merged env, for `next.config.ts` `env` so Next inlines them. */
export const publicEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(loadSource()).filter(
      (entry): entry is [string, string] => entry[0].startsWith('NEXT_PUBLIC_') && !!entry[1],
    ),
  );
