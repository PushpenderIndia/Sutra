'use client';
import { Languages, MessageCircle, SunMoon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useSetLocale, useToggleTheme } from '@/components/shell/preferences';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { LOCALE_NAMES, LOCALES } from '@/i18n/config';
import { useShell } from '@/lib/shell';
import { TAB_ICONS, TABS } from '@/lib/tabs';

/** ⌘K / Ctrl+K: jump to a tab, toggle the chat or theme, change language. */
export function CommandMenu() {
  const t = useTranslations('command');
  const tabs = useTranslations('tabs');
  const router = useRouter();
  const { commandOpen, setCommandOpen, setChatOpen } = useShell();
  const toggleTheme = useToggleTheme();
  const setLocale = useSetLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen(!useShell.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandOpen]);

  const run = (fn: () => unknown) => () => {
    setCommandOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      title={t('title')}
      description={t('description')}
    >
      <Command>
        <CommandInput placeholder={t('placeholder')} />
        <CommandList>
          <CommandEmpty>{t('empty')}</CommandEmpty>
          <CommandGroup heading={t('go')}>
            {TABS.map((tab) => {
              const Icon = TAB_ICONS[tab];
              return (
                <CommandItem key={tab} onSelect={run(() => router.push(`/${tab}`))}>
                  <Icon aria-hidden />
                  {tabs(tab)}
                </CommandItem>
              );
            })}
          </CommandGroup>
          <CommandGroup heading={t('actions')}>
            <CommandItem onSelect={run(() => setChatOpen(!useShell.getState().chatOpen))}>
              <MessageCircle aria-hidden />
              {t('toggleChat')}
            </CommandItem>
            <CommandItem onSelect={run(toggleTheme)}>
              <SunMoon aria-hidden />
              {t('toggleTheme')}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('language')}>
            {LOCALES.map((l) => (
              <CommandItem
                key={l}
                value={`language ${LOCALE_NAMES[l]}`}
                onSelect={run(() => setLocale(l))}
              >
                <Languages aria-hidden />
                <span lang={l}>{LOCALE_NAMES[l]}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
