'use client';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AgentGraph } from '@/components/graph/agent-graph';
import { Logo } from '@/components/shell/header';
import { Button } from '@/components/ui/button';
import { demoRecording, flashingAt, replayAt } from '@/lib/graph/replay';
import { cn } from '@/lib/utils';

const STEP_MS = 100;
const SPEEDS = [1, 2, 4] as const;

/** Plays the recorded run; every frame is `replayAt(recording, t)`, so it is reproducible. */
export function ReplayPlayer({ at }: { at?: number }) {
  const t = useTranslations('graph.replay');
  const recording = useMemo(demoRecording, []);
  const [time, setTime] = useState(at ?? 0);
  const [playing, setPlaying] = useState(at === undefined);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setTime((x) => {
          const next = x + STEP_MS * speed;
          if (next < recording.duration) return next;
          setPlaying(false);
          return recording.duration;
        }),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [playing, speed, recording.duration]);

  const run = useMemo(() => replayAt(recording, time), [recording, time]);
  const now = Date.parse(recording.startedAt) + time;
  const flashing = useMemo(() => flashingAt(recording, time), [recording, time]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Logo />
          {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
        <Button
          size="sm"
          onClick={() => {
            if (time >= recording.duration) setTime(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? t('pause') : t('play')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setTime(0)}>
          <RotateCcw aria-hidden />
          {t('restart')}
        </Button>
        <fieldset className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          <legend className="sr-only">{t('speed')}</legend>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs tabular-nums',
                speed === s ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
              )}
            >
              {s}×
            </button>
          ))}
        </fieldset>
        <input
          type="range"
          aria-label={t('position')}
          min={0}
          max={recording.duration}
          step={STEP_MS}
          value={time}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
          className="min-w-40 flex-1 accent-(--saffron)"
        />
        <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">
          {(time / 1000).toFixed(1)}s / {recording.duration / 1000}s
        </span>
      </div>

      <div className="flex flex-col gap-3 [&>section]:h-14 [&>section]:rounded-xl [&>section]:border [&>section]:bg-background [&>section]:px-3">
        <AgentGraph
          run={run}
          topology={recording.topology}
          now={now}
          flashing={flashing}
          variant="inline"
          defaultExpanded
          onRerun={(nodeId) => {
            const start = recording.frames.find((f) => 'nodeId' in f && f.nodeId === nodeId);
            if (!start) return;
            setTime(start.at);
            toast(t('rerun', { agent: nodeId }));
          }}
        />
      </div>
    </main>
  );
}
