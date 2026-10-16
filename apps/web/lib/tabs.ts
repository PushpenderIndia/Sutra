import { tab } from '@sutra/domain';
import { BriefcaseBusiness, Inbox, type LucideIcon, Megaphone, UsersRound } from 'lucide-react';

/** The four tabs, in order. Each is a route under `app/(app)/`. */
export const TABS = tab.options;
export type Tab = (typeof TABS)[number];

export const TAB_ICONS: Record<Tab, LucideIcon> = {
  business: BriefcaseBusiness,
  prospects: UsersRound,
  campaigns: Megaphone,
  leads: Inbox,
};

/** The tab a pathname belongs to (`/leads/x` → `leads`). */
export const tabOf = (pathname: string): Tab | undefined =>
  TABS.find((t) => pathname === `/${t}` || pathname.startsWith(`/${t}/`));
