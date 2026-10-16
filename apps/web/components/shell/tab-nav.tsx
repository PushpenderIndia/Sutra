'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useSelection } from '@/lib/selection';
import { TAB_ICONS, TABS, tabOf } from '@/lib/tabs';
import { cn } from '@/lib/utils';

/** The four tabs as links (each tab is a route); keeps the selection context's `tab` in sync. */
export function TabNav() {
  const t = useTranslations('tabs');
  const pathname = usePathname();
  const active = tabOf(pathname);
  const setTab = useSelection((s) => s.setTab);
  useEffect(() => setTab(active), [active, setTab]);

  return (
    <nav
      aria-label={t('label')}
      className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur"
    >
      <ul className="flex gap-0.5 overflow-x-auto px-2 sm:gap-1 md:px-4">
        {TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          const current = tab === active;
          return (
            <li key={tab}>
              <Link
                href={`/${tab}`}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'relative flex h-11 items-center gap-2 px-2 sm:px-2.5 font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                  current &&
                    'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-saffron',
                )}
              >
                <Icon aria-hidden className="hidden size-4 sm:block" />
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
