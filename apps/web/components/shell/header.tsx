'use client';
import type { Topology } from '@sutra/agents/topology';
import { LogOut, PanelRight, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AgentGraphBar } from '@/components/shell/agent-graph-bar';
import { CommandMenu } from '@/components/shell/command-menu';
import { LocaleSwitcher, ThemeToggle } from '@/components/shell/preferences';
import { type WorkspaceOption, WorkspaceSwitcher } from '@/components/shell/workspace-switcher';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { authClient } from '@/lib/auth-client';
import type { RunState } from '@/lib/graph/model';
import { useShell } from '@/lib/shell';

export type HeaderUser = { name: string; email: string; image?: string | null };

/** Logo · workspace ▾ · <AgentGraphBar/> · ⌘K · language · theme · chat · user. */
export function Header({
  user,
  workspace,
  workspaces,
  run,
  topology,
  canRerun,
}: {
  user: HeaderUser;
  workspace: WorkspaceOption;
  workspaces: WorkspaceOption[];
  run: RunState | null;
  topology: Topology;
  canRerun: boolean;
}) {
  const t = useTranslations('shell');
  const router = useRouter();
  const { chatOpen, setChatOpen, setCommandOpen } = useShell();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:gap-3 md:px-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('skip')}
      </a>
      <Link
        href="/business"
        className="flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Logo />
        <span className="sr-only sm:not-sr-only">Sutra</span>
      </Link>
      <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
      <WorkspaceSwitcher active={workspace} workspaces={workspaces} />
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <AgentGraphBar run={run} topology={topology} canRerun={canRerun} />
      </div>
      <Button
        variant="outline"
        className="hidden gap-2 text-muted-foreground 2xl:flex"
        onClick={() => setCommandOpen(true)}
      >
        <Search aria-hidden />
        {t('search')}
        <Kbd>⌘K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="2xl:hidden"
        aria-label={t('search')}
        onClick={() => setCommandOpen(true)}
      >
        <Search aria-hidden />
      </Button>
      <div className="hidden items-center sm:flex">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label={t('toggleChat')}
        aria-pressed={chatOpen}
        onClick={() => setChatOpen(!chatOpen)}
      >
        <PanelRight aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full" aria-label={t('account')}>
            <Avatar className="size-7">
              {user.image && <AvatarImage src={user.image} alt="" />}
              <AvatarFallback className="bg-saffron/20 text-xs font-medium text-saffron-ink">
                {(user.name || user.email).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span className="truncate text-foreground">{user.name}</span>
            <span className="truncate font-normal text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={async () => {
              await authClient.signOut();
              router.push('/sign-in');
            }}
          >
            <LogOut aria-hidden />
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CommandMenu />
    </header>
  );
}

/** The mark: a saffron thread through an ink knot. */
export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <rect width="24" height="24" rx="7" className="fill-primary" />
      <path
        d="M5 15.5c3-6 6.5 2.5 9.5-3.5S19 9 19 9"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="stroke-saffron"
      />
      <circle cx="12" cy="12.4" r="1.6" className="fill-primary-foreground" />
    </svg>
  );
}
