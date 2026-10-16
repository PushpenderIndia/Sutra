import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { Suspense } from 'react';
import { ReplayPlayer } from './replay-player';

export const metadata: Metadata = { title: 'Agent graph replay' };

/**
 * A storybook-style fixture: replays a recorded run of the full pipeline through the real
 * agent graph, for demos and visual checks. `?t=<seconds>` opens at a moment, paused.
 */
export default function AgentGraphFixture({ searchParams }: PageProps<'/fixtures/agent-graph'>) {
  return (
    <Suspense>
      <NextIntlClientProvider timeZone="UTC">
        <Player searchParams={searchParams} />
      </NextIntlClientProvider>
    </Suspense>
  );
}

async function Player({ searchParams }: Pick<PageProps<'/fixtures/agent-graph'>, 'searchParams'>) {
  const { t } = await searchParams;
  const at = Number(Array.isArray(t) ? t[0] : t);
  return <ReplayPlayer at={Number.isFinite(at) ? at * 1000 : undefined} />;
}
