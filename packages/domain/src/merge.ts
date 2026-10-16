import { z } from 'zod';

/**
 * The only merge fields a template may use. Templates stay fixed per variant so A/B comparisons are
 * fair; everything contact-specific flows through one of these placeholders:
 * - `firstName`, `company`, `senderName` are filled deterministically from the contact and workspace;
 * - `personalization` is the one line written per contact at send time (grounded in research).
 */
export const MERGE_FIELDS = ['firstName', 'company', 'personalization', 'senderName'] as const;
export const mergeField = z.enum(MERGE_FIELDS);
export type MergeField = (typeof MERGE_FIELDS)[number];

const MERGE_FIELD_SET: ReadonlySet<string> = new Set(MERGE_FIELDS);

/** Matches `{{ fieldName }}` (tolerant of inner whitespace). */
const MERGE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** The distinct merge field names referenced in `text`, in first-seen order. */
export function mergeFieldsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const [, name] of text.matchAll(MERGE_PATTERN)) if (name) seen.add(name);
  return [...seen];
}

/** Referenced placeholders that are not one of the allowed {@link MERGE_FIELDS}. */
export function unknownMergeFields(text: string): string[] {
  return mergeFieldsIn(text).filter((name) => !MERGE_FIELD_SET.has(name));
}

/** Only the allowed merge fields are substituted; unknown placeholders are left untouched. */
export function fillMergeFields(text: string, values: Partial<Record<MergeField, string>>): string {
  return text.replace(MERGE_PATTERN, (match, name: string) =>
    MERGE_FIELD_SET.has(name) ? (values[name as MergeField] ?? match) : match,
  );
}

/** Placeholders from {@link MERGE_FIELDS} that `text` does NOT use (e.g. a body with no `{{company}}`). */
export const missingMergeFields = (text: string, required: readonly MergeField[]): MergeField[] =>
  required.filter((field) => !text.includes(`{{${field}}}`));
