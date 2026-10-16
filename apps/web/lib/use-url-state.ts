'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * A search-param-backed value (`?status=interested`), so filters and the open row survive
 * reloads, can be shared, and are visible to the chat. `null` removes the param.
 */
export function useUrlState(key: string): [string | null, (value: string | null) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const set = useCallback(
    (value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null) next.delete(key);
      else next.set(key, value);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [key, pathname, router],
  );
  return [params.get(key), set];
}
