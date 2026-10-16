'use client';
import { useSyncExternalStore } from 'react';

/** `true` while `query` matches. Always `false` on the server and the first client render. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The mobile breakpoint from the layout spec (≤ 768px). */
export const useIsMobile = () => useMediaQuery('(max-width: 768px)');
