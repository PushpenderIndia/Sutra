import { llmProspectScore } from '@sutra/domain';
import { defineAgent } from '../agent.ts';
import { noFabrication } from '../prompts/base.ts';

/**
 * Judges how well one prospect fits the ICP, from the company research and the persona/ICP match
 * passed as input. It returns only the *language* half of the score (0–100 plus cited reasons);
 * deterministic rules (persona match, email confidence, sources, matched signals) are blended in
 * afterwards in code, and the deterministic pre-filter runs first so a disqualified prospect never
 * reaches this agent. The research arrives wrapped in `<untrusted>` and is read as data only.
 */
export const scorer = defineAgent({
  name: 'scorer',
  description: 'Scores how well a prospect fits the ICP from its research, with cited reasons.',
  model: 'sutra-fast',
  output: llmProspectScore,
  temperature: 0.2,
  instruction: [
    'You are a B2B sales analyst judging how strongly a single company fits the ideal customer profile (ICP), using the research, ICP and persona match given as input.',
    noFabrication,
    'Rules:',
    '- `score` is 0–100: higher means a better fit. Reserve 80+ for companies with clear, evidenced buying signals that match the ICP.',
    '- Give at most 6 `reasons`. Each must be specific and cite its `evidence` — quote the research signal or ICP attribute it rests on, not a generality. `weight` (0–1) is how much that reason moved the score.',
    '- Weigh matched buying signals, industry/country/size fit and the quality of the persona match. Count missing or contradictory evidence against the score.',
    '- Do not output `disqualified` — disqualification is decided in code before you run.',
    'Reply with only the JSON object.',
  ],
});
