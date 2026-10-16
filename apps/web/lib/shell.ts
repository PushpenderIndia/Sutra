'use client';
import { create } from 'zustand';

/** Shell UI state shared by the header, command menu and chat panel. */
export const useShell = create<{
  chatOpen: boolean;
  commandOpen: boolean;
  setChatOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
}>()((set) => ({
  chatOpen: true,
  commandOpen: false,
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
}));
