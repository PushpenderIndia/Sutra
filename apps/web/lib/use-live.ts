'use client';
import { useQuery } from '@tanstack/react-query';

/**
 * Server-rendered data that keeps itself fresh: starts from `initialData` (from the page) and
 * polls `url` (a `route()` handler returning the same shape) every `intervalMs`.
 */
export function useLive<T>(url: string, initialData: T, intervalMs = 15_000): T {
  const { data } = useQuery({
    queryKey: [url],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return (await res.json()) as T;
    },
    initialData,
    refetchInterval: intervalMs,
  });
  return data ?? initialData;
}
