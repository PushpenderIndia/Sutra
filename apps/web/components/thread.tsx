'use client';
import { useFormatter, useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';
import type { ThreadMessage } from '@/lib/data/leads';
import { cn } from '@/lib/utils';

/** An email thread: our messages on the right, theirs on the left with the reply analysis. */
export function Thread({ messages, className }: { messages: ThreadMessage[]; className?: string }) {
  const t = useTranslations('thread');
  const format = useFormatter();
  if (!messages.length) return <p className="text-muted-foreground">{t('empty')}</p>;
  return (
    <ol className={cn('flex flex-col gap-3', className)}>
      {messages.map((m) => {
        const ours = m.direction === 'outbound';
        return (
          <li key={m.id} className={cn('flex flex-col gap-1', ours ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[92%] rounded-2xl border px-3.5 py-2.5',
                ours ? 'rounded-br-sm bg-secondary' : 'rounded-bl-sm bg-card',
              )}
            >
              <p className="font-medium">{m.subject}</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{m.body}</p>
            </div>
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <span>{ours ? t('you') : t('them')}</span>
              <span aria-hidden>·</span>
              <time dateTime={m.at}>
                {format.dateTime(new Date(m.at), { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              {m.analysis && <StatusBadge status={m.analysis.intent} />}
            </div>
            {m.analysis && (
              <p className="max-w-[92%] px-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{t('summary')}:</span>{' '}
                {m.analysis.summary}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
