'use client';
import { CircleCheck, Hand } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * A human checkpoint banner ("Is this you?", "Approve campaign"). Once `confirmed`, it settles
 * into a quiet done state. `onConfirm` may be async; the button shows progress meanwhile.
 */
export function Checkpoint({
  title,
  summary,
  onConfirm,
  confirmLabel,
  confirmed = false,
  className,
}: {
  title: string;
  summary: React.ReactNode;
  onConfirm?: () => unknown | Promise<unknown>;
  confirmLabel?: string;
  confirmed?: boolean;
  className?: string;
}) {
  const t = useTranslations('checkpoint');
  const [pending, start] = useTransition();
  const Icon = confirmed ? CircleCheck : Hand;
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center',
        confirmed
          ? 'bg-card'
          : 'border-saffron/50 bg-linear-to-r from-saffron/12 via-saffron/5 to-transparent',
        className,
      )}
    >
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          confirmed
            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
            : 'motion-safe:animate-glow bg-saffron text-neutral-950',
        )}
      >
        <Icon className="size-4.5" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium">
          {title}
          {confirmed && <span className="ml-2 text-muted-foreground">· {t('confirmed')}</span>}
        </p>
        <div className="text-muted-foreground">{summary}</div>
      </div>
      {!confirmed && onConfirm && (
        <Button
          disabled={pending}
          onClick={() => start(async () => void (await onConfirm()))}
          className="sm:ml-auto"
        >
          {pending ? t('confirming') : (confirmLabel ?? t('confirm'))}
        </Button>
      )}
    </section>
  );
}
