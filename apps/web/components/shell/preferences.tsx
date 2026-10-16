'use client';
import { Check, Languages, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALE_COOKIE, LOCALE_NAMES, LOCALES, type UiLocale } from '@/i18n/config';

/** Light ↔ dark. Both icons render and CSS picks one, so there's no hydration mismatch. */
export function useToggleTheme() {
  const { resolvedTheme, setTheme } = useTheme();
  return () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
}

export function ThemeToggle() {
  const t = useTranslations('shell');
  const toggle = useToggleTheme();
  return (
    <Button variant="ghost" size="icon" aria-label={t('toggleTheme')} onClick={toggle}>
      <Sun className="dark:hidden" aria-hidden />
      <Moon className="hidden dark:block" aria-hidden />
    </Button>
  );
}

/** Saves the UI language in a cookie and re-renders the server tree in it. */
export function useSetLocale() {
  const router = useRouter();
  return async (locale: UiLocale) => {
    await cookieStore.set({
      name: LOCALE_COOKIE,
      value: locale,
      path: '/',
      expires: Date.now() + 365 * 86_400_000,
      sameSite: 'lax',
    });
    router.refresh();
  };
}

export function LocaleSwitcher() {
  const t = useTranslations('shell');
  const current = useLocale();
  const setLocale = useSetLocale();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language')}>
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l} lang={l} onSelect={() => setLocale(l)}>
            {LOCALE_NAMES[l]}
            {l === current && <Check aria-hidden className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Keeps `<html lang>` in step with the UI language (the root layout is static). */
export function HtmlLang() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
