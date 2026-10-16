import type { CompanyDraft, ContactDraft, Country, LeadDraft } from '@sutra/domain';
import { country as countrySchema } from '@sutra/domain';
import type { CsvMapping } from '../clients.ts';
import type { LeadSource } from '../types.ts';

/** Minimal RFC-4180 CSV parse into header-keyed rows (quotes, commas and newlines in fields). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  const push = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    push();
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') push();
    else if (ch === '\n') endRecord();
    else if (ch !== '\r') field += ch;
  }
  if (field || record.length) endRecord();

  const [headers = [], ...body] = records;
  const trimmed = headers.map((h) => h.trim());
  const rows = body
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(trimmed.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers: trimmed, rows };
}

const MATCHERS: { field: keyof CsvMapping; re: RegExp }[] = [
  { field: 'email', re: /e-?mail/i },
  { field: 'website', re: /web|site|url|homepage/i },
  { field: 'domain', re: /domain/i },
  { field: 'contactName', re: /contact|person|full.?name|^name$/i },
  { field: 'name', re: /company|organi[sz]ation|business|account/i },
  { field: 'title', re: /title|role|position|job/i },
  { field: 'country', re: /country|nation/i },
  { field: 'city', re: /city|town|location/i },
];

/** A heuristic column mapping from header names, used when no AI mapping is supplied. */
export function guessMapping(headers: readonly string[]): CsvMapping {
  const mapping: CsvMapping = {};
  for (const header of headers)
    for (const { field, re } of MATCHERS)
      if (!mapping[field] && re.test(header)) {
        mapping[field] = header;
        break;
      }
  return mapping;
}

const value = (row: Record<string, string>, column?: string): string | undefined => {
  const v = column ? row[column]?.trim() : undefined;
  return v || undefined;
};

const asCountry = (raw: string | undefined): Country | undefined => {
  const parsed = countrySchema.safeParse(raw?.toUpperCase());
  return parsed.success ? parsed.data : undefined;
};

/** One CSV row → a company draft and, if an email is present, a contact draft. Nameless rows skip. */
export function rowToDrafts(row: Record<string, string>, mapping: CsvMapping): LeadDraft[] {
  const drafts: LeadDraft[] = [];
  const name = value(row, mapping.name) ?? value(row, mapping.contactName);
  const website = value(row, mapping.website);
  const domain = value(row, mapping.domain);
  if (name) {
    const company: CompanyDraft = {
      kind: 'company',
      name,
      website,
      domain,
      country: asCountry(value(row, mapping.country)),
      city: value(row, mapping.city),
      industry: value(row, mapping.industry),
      source: 'csv',
      ref: 'upload',
    };
    drafts.push(company);
  }
  const email = value(row, mapping.email);
  if (email) {
    const contact: ContactDraft = {
      kind: 'contact',
      companyDomain: domain,
      companyName: name,
      name: value(row, mapping.contactName),
      title: value(row, mapping.title),
      email,
      emailConfidence: 'verified',
      source: 'csv',
    };
    drafts.push(contact);
  }
  return drafts;
}

/**
 * `csv`: an uploaded file with an AI- (or heuristic-) guessed column mapping. There is one query
 * (the upload itself); each row becomes a company and, when it carries an address, a contact.
 */
export const csvSource: LeadSource = {
  id: 'csv',
  label: 'CSV',
  cost: 'free',
  enabled: (ctx) => ctx.enabledSources.includes('csv') && Boolean(ctx.csv),
  plan: () => [{ source: 'csv', text: 'upload' }],
  async *fetch(ctx) {
    const csv = ctx.csv;
    if (!csv) return;
    for (const row of csv.rows) for (const draft of rowToDrafts(row, csv.mapping)) yield draft;
  },
};
