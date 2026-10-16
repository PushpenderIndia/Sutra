'use client';
import { create } from 'zustand';
import type { Tab } from '@/lib/tabs';

export type Selection = {
  /** The tab on screen. */
  tab: Tab | undefined;
  /** Ids of the rows selected in that tab's table (checkboxes or the open row). */
  selectedIds: string[];
  setTab: (tab: Tab | undefined) => void;
  select: (ids: string[]) => void;
  clear: () => void;
};

/**
 * What the user is looking at. The chat panel reads it, so "rewrite this one" knows what
 * "this" is. Switching tabs clears the selection.
 */
export const useSelection = create<Selection>()((set, get) => ({
  tab: undefined,
  selectedIds: [],
  setTab: (tab) => {
    if (get().tab !== tab) set({ tab, selectedIds: [] });
  },
  select: (ids) => set({ selectedIds: ids }),
  clear: () => set({ selectedIds: [] }),
}));
