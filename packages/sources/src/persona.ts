import type { Persona } from '@sutra/domain';

const normalise = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The significant words of a title, ignoring filler, for a loose keyword overlap match. */
const keywords = (title: string): string[] =>
  normalise(title)
    .split(' ')
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'of'].includes(w));

/**
 * Maps a job title to one of the ICP personas by exact title, then alt-title, then keyword overlap.
 * Returns the matched persona's `title`, or `undefined` when nothing is close enough — the caller
 * (the contact finder) may then fall back to an LLM fuzzy match.
 */
export function matchPersona(
  title: string | undefined,
  personas: readonly Persona[],
): string | undefined {
  if (!title) return undefined;
  const wanted = normalise(title);
  if (!wanted) return undefined;

  for (const persona of personas) {
    const names = [persona.title, ...persona.altTitles].map(normalise);
    if (names.includes(wanted)) return persona.title;
  }

  const titleWords = new Set(keywords(title));
  let best: { title: string; overlap: number } | undefined;
  for (const persona of personas) {
    for (const candidate of [persona.title, ...persona.altTitles]) {
      const overlap = keywords(candidate).filter((w) => titleWords.has(w)).length;
      if (overlap && (!best || overlap > best.overlap)) best = { title: persona.title, overlap };
    }
  }
  return best?.title;
}
