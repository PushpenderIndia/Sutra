import { describe, expect, it } from 'vitest';
import {
  fillMergeFields,
  MERGE_FIELDS,
  mergeFieldsIn,
  missingMergeFields,
  unknownMergeFields,
} from './merge.ts';

describe('merge fields', () => {
  const body =
    'Hi {{firstName}}, {{personalization}} — worth a chat about {{company}}? {{senderName}}';

  it('lists the distinct fields used, in order', () => {
    expect(mergeFieldsIn(body)).toEqual(['firstName', 'personalization', 'company', 'senderName']);
  });

  it('is tolerant of inner whitespace', () => {
    expect(mergeFieldsIn('{{ firstName }}')).toEqual(['firstName']);
  });

  it('flags placeholders that are not allowed merge fields', () => {
    expect(unknownMergeFields('Hi {{firstName}} {{coupon}}')).toEqual(['coupon']);
    expect(unknownMergeFields(body)).toEqual([]);
  });

  it('fills only known fields and leaves unknown placeholders untouched', () => {
    const filled = fillMergeFields('Hi {{firstName}} at {{company}} {{coupon}}', {
      firstName: 'Budi',
      company: 'Kopi',
    });
    expect(filled).toBe('Hi Budi at Kopi {{coupon}}');
  });

  it('reports required fields a template is missing', () => {
    expect(missingMergeFields('Hi {{firstName}}', [...MERGE_FIELDS])).toEqual([
      'company',
      'personalization',
      'senderName',
    ]);
  });
});
