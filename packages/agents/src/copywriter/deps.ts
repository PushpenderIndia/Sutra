import { personalizer, sequencePlanner, translator, variantWriter } from '../agents/copywriter.ts';

/**
 * The copywriter's LLM agents behind one seam (mirrors the profiler/prospector/enricher). Real
 * `sutra-smart`/`sutra-fast` agents by default; tests swap any of them for an agent pointed at the
 * mock LLM proxy with {@link setCopywriterDeps}. All language goes through this seam — the sequence
 * structure, variant management, quality gate and merge fields stay deterministic in code.
 */
export interface CopywriterDeps {
  sequencePlanner: typeof sequencePlanner;
  variantWriter: typeof variantWriter;
  translator: typeof translator;
  personalizer: typeof personalizer;
}

let override: Partial<CopywriterDeps> = {};

/** Overrides some or all copywriter dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setCopywriterDeps = (deps: Partial<CopywriterDeps>) => {
  override = deps;
};

const defaults = (): CopywriterDeps => ({
  sequencePlanner,
  variantWriter,
  translator,
  personalizer,
});

export const copywriterDeps = (): CopywriterDeps => ({ ...defaults(), ...override });
