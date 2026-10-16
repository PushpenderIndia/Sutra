import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import hi from '../messages/hi.json';
import id from '../messages/id.json';
import { flatten, merge, missing, placeholders } from './catalog.ts';

describe('message catalogs', () => {
  const source = {
    a: 'Hello {name}',
    b: { c: 'Bye', d: '{count, plural, one {# row} other {# rows}}' },
  };

  it('finds missing and empty keys', () => {
    expect(missing(source, { a: 'Namaste {name}', b: { c: ' ' } })).toEqual({
      'b.c': 'Bye',
      'b.d': source.b.d,
    });
  });

  it('merges translations in source shape and drops stale keys', () => {
    const merged = merge(source, { a: 'Halo {name}', old: 'x' }, { 'b.c': 'Dah' });
    expect(merged).toEqual({ a: 'Halo {name}', b: { c: 'Dah', d: source.b.d } });
  });

  it('extracts ICU placeholders', () => {
    expect(placeholders(source.b.d)).toEqual(['count']);
    expect(placeholders('{step} · {variant}')).toEqual(['step', 'variant']);
  });

  it.each([
    ['hi', hi],
    ['id', id],
  ])('%s has every English key with the same placeholders', (_, catalog) => {
    expect(missing(en, catalog)).toEqual({});
    const theirs = flatten(catalog);
    for (const [k, v] of Object.entries(flatten(en))) {
      expect(placeholders(theirs[k] ?? ''), k).toEqual(placeholders(v));
    }
  });
});
