import { TONES, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

/** A status dot; `live` makes it pulse (motion is disabled under `prefers-reduced-motion`). */
export function LiveDot({
  tone = 'accent',
  live = false,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn('relative inline-flex size-2 shrink-0', className)}>
      {live && (
        <span
          className={cn(
            'absolute inset-0 motion-safe:animate-ping rounded-full opacity-60',
            TONES[tone].dot,
          )}
        />
      )}
      <span className={cn('relative inline-flex size-2 rounded-full', TONES[tone].dot)} />
    </span>
  );
}
