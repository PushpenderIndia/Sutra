import { setTimeout as sleep } from 'node:timers/promises';
import { BasePlugin, type LlmRequest } from '@google/adk';
import { env } from '@sutra/config';
import { db } from '@sutra/db';

const MINUTE = 60_000;

/** `LLM_RPM_LIMITS` ("sutra-fast=15,sutra-smart=10") as a map. */
export const rpmLimits = (spec = env.LLM_RPM_LIMITS): Record<string, number> =>
  Object.fromEntries(
    spec.split(',').map((pair) => [pair.split('=')[0], Number(pair.split('=')[1])]),
  );

type Window = { _id: string; count: number; expiresAt: Date };
// Global, not per workspace: every workspace shares the one free-tier key.
const windows = () => db().collection<Window>('llm_rate_windows');
let ttl: Promise<unknown> | undefined;

/**
 * Waits until a request to `model` fits its per-minute cap. Counters live in Mongo, so the
 * cap holds across Cloud Run instances. Fixed one-minute windows, matching how Gemini counts RPM.
 */
export async function acquireModelSlot(
  model: string,
  {
    rpm = rpmLimits()[model],
    now = Date.now,
    wait = (ms: number) => sleep(ms),
  }: { rpm?: number; now?: () => number; wait?: (ms: number) => Promise<unknown> } = {},
) {
  if (!rpm) return;
  ttl ??= windows().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await ttl;
  for (;;) {
    const window = Math.floor(now() / MINUTE);
    const doc = await windows().findOneAndUpdate(
      { _id: `${model}:${window}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * MINUTE) } },
      { upsert: true, returnDocument: 'after' },
    );
    if ((doc?.count ?? 0) <= rpm) return;
    await wait((window + 1) * MINUTE - now());
  }
}

/** Holds each model call until the model's rate limit allows it. */
export class RateLimiter extends BasePlugin {
  constructor() {
    super('rate_limiter');
  }

  override async beforeModelCallback({ llmRequest }: { llmRequest: LlmRequest }) {
    if (llmRequest.model) await acquireModelSlot(llmRequest.model);
    return undefined;
  }
}
