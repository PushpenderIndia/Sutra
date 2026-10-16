import type { LucideIcon } from 'lucide-react';
import { TONES, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

export type StatItem = {
  key: string;
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  /** A second line, e.g. "18% reply rate". */
  hint?: React.ReactNode;
};

/**
 * A row of stat cards. With `onSelect` the cards are filter toggles: clicking the active card
 * clears the filter (`null`).
 */
export function StatCards({
  items,
  active,
  onSelect,
  className,
  label,
}: {
  items: StatItem[];
  active?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
  /** Accessible name for the group. */
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] lg:gap-3',
        className,
      )}
    >
      {items.map(({ key, label, value, icon: Icon, tone = 'neutral', hint }) => {
        const selected = active === key;
        const body = (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className={cn('size-1.5 rounded-full', TONES[tone].dot)} />
              <span className="truncate">{label}</span>
              {Icon && <Icon aria-hidden className="ml-auto size-3.5 opacity-70" />}
            </span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
            {hint && <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>}
          </>
        );
        const box = cn(
          'flex h-full w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left shadow-xs transition-colors',
          selected && 'border-saffron/70 ring-2 ring-saffron/25',
        );
        return (
          <li key={key}>
            {onSelect ? (
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : key)}
                className={cn(
                  box,
                  'outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50',
                )}
              >
                {body}
              </button>
            ) : (
              <div className={box}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
