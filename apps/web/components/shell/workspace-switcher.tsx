'use client';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/lib/auth-client';

export type WorkspaceOption = { id: string; name: string };

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || 'S';

/** The active workspace and a menu to switch or create one. Server props render it first. */
export function WorkspaceSwitcher({
  active,
  workspaces: initialList,
}: {
  active: WorkspaceOption;
  workspaces: WorkspaceOption[];
}) {
  const t = useTranslations('workspace');
  const { workspace, workspaces, switchTo } = useWorkspace();
  const current = workspace ? { id: workspace.id, name: workspace.name } : active;
  const list = workspaces.length ? workspaces : initialList;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="max-w-36 gap-2 px-1.5 sm:max-w-56"
          aria-label={t('switch')}
        >
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initial(current.name)}
          </span>
          <span className="truncate">{current.name}</span>
          <span className="sr-only">{t('switch')}</span>
          <ChevronsUpDown aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        {list.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => w.id !== current.id && switchTo(w.id)}>
            <span
              aria-hidden
              className="flex size-5 items-center justify-center rounded bg-secondary text-[10px] font-semibold"
            >
              {initial(w.name)}
            </span>
            <span className="truncate">{w.name}</span>
            {w.id === current.id && <Check aria-hidden className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus aria-hidden />
            {t('create')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
