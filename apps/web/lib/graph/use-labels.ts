'use client';
import { useTranslations } from 'next-intl';
import { type GraphNode, humanize } from './model';

type Key = Parameters<ReturnType<typeof useTranslations<'graph'>>>[0];

/** A node's display name: translated when known, else the topology label or a humanized id. */
export function useNodeLabel() {
  const t = useTranslations('graph');
  const sources = useTranslations('sources');
  const known = (key: string) => (t.has(key as Key) ? t(key as Key) : undefined);
  return (n: GraphNode, { short = false } = {}): string => {
    if (n.role === 'placeholder') return t('perSource');
    if (n.item)
      return sources.has(n.name as Parameters<typeof sources>[0])
        ? sources(n.name as Parameters<typeof sources>[0])
        : humanize(n.name);
    if (n.role === 'child') return known(`sub.${n.name}`) ?? humanize(n.name);
    if (n.role === 'human') return short ? t('you') : (known(`checkpoints.${n.name}`) ?? n.label);
    return known(`agents.${n.name}`) ?? n.label;
  };
}
