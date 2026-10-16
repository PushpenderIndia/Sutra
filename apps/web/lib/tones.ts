/** Semantic colours shared by badges, dots and stat cards. */
export const TONES = {
  neutral: { badge: 'bg-secondary text-secondary-foreground', dot: 'bg-muted-foreground' },
  muted: { badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
  info: {
    badge: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
    dot: 'bg-sky-500',
  },
  accent: {
    badge: 'bg-saffron/15 text-saffron-ink',
    dot: 'bg-saffron',
  },
  success: {
    badge: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  warning: {
    badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  danger: {
    badge: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
} as const;
export type Tone = keyof typeof TONES;
