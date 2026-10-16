'use client';
import type { Topology } from '@sutra/agents/topology';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { rerunFrom } from '@/actions/pipeline';
import { AgentGraph } from '@/components/graph/agent-graph';
import { isActive, mergeRun, type RunState } from '@/lib/graph/model';

const KEY = ['pipeline-run'];
/** Poll fast while agents work, slowly when idle (free-tier friendly). */
const ACTIVE_MS = 1_500;
const IDLE_MS = 10_000;
const FLASH_MS = 2_400;

async function poll(previous: RunState | null, signal: AbortSignal) {
  const url = previous
    ? `/api/pipeline/${previous.id}?after=${encodeURIComponent(previous.cursor)}`
    : '/api/pipeline/latest';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return mergeRun(previous, (await res.json()) as RunState | null);
}

/** Ticks every second while `on`, for live durations. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/** Event-driven nodes whose update arrived in the last couple of seconds. */
function useFlashing(run: RunState | null, triggers: readonly string[]) {
  const seen = useRef<Map<string, string> | null>(null);
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const latest = new Map(
      (run?.nodes ?? [])
        .filter((n) => triggers.includes(n.nodeId))
        .map((n) => [n.nodeId, n.updatedAt]),
    );
    const first = seen.current === null;
    const fired = first
      ? []
      : [...latest].filter(([id, at]) => seen.current?.get(id) !== at).map(([id]) => id);
    seen.current = latest;
    if (!fired.length) return;
    setFlashing((s) => new Set([...s, ...fired]));
    const timer = setTimeout(
      () => setFlashing((s) => new Set([...s].filter((id) => !fired.includes(id)))),
      FLASH_MS,
    );
    return () => clearTimeout(timer);
  }, [run, triggers]);
  return flashing;
}

/**
 * The top bar's live agent graph: starts from the server-rendered latest run, then polls
 * `GET /api/pipeline/[runId]?after=` for changed nodes (1.5s while active, 10s when idle).
 */
export function AgentGraphBar({
  run,
  topology,
  canRerun = false,
}: {
  run: RunState | null;
  topology: Topology;
  canRerun?: boolean;
}) {
  const t = useTranslations('graph');
  const triggers = useMemo(
    () => Object.keys(topology).filter((id) => topology[id]?.trigger),
    [topology],
  );
  const client = useQueryClient();
  const { data = null } = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => poll(client.getQueryData<RunState | null>(KEY) ?? null, signal),
    initialData: run,
    staleTime: 0,
    refetchInterval: (q) => (isActive(q.state.data ?? null) ? ACTIVE_MS : IDLE_MS),
  });
  const now = useNow(isActive(data));
  const flashing = useFlashing(data, triggers);

  const onRerun = async (nodeId: string) => {
    const result = await rerunFrom({ nodeId });
    if (!result.ok) return toast.error(result.error);
    toast.success(t('rerunStarted'));
    await client.invalidateQueries({ queryKey: KEY });
  };

  return (
    <AgentGraph
      run={data}
      topology={topology}
      now={now}
      flashing={flashing}
      onRerun={canRerun ? onRerun : undefined}
    />
  );
}
