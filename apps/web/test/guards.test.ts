import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.next', '.turbo']);

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

const exportsOf = (code: string) => code.match(/^export\s.*$/gm) ?? [];
const METHOD = '(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)';

/** Every reason `file` breaks the "everything goes through a guard" rule. */
function violations(file: string, code: string): string[] {
  const problems: string[] = [];
  const isActionFile = /^\s*['"]use server['"]/.test(code);
  if (!isActionFile && /['"]use server['"]/.test(code)) {
    problems.push(`${file}: inline 'use server'; define actions in a 'use server' file`);
  }
  if (isActionFile) {
    for (const line of exportsOf(code)) {
      if (!/^export const \w+ = (action|userAction)\(/.test(line)) {
        problems.push(`${file}: "${line}" must be \`export const x = action(…)\``);
      }
    }
  }
  if (/(^|\/)app\/api\/.*\/route\.ts$/.test(file)) {
    if (/app\/api\/auth\//.test(file)) return problems; // Better Auth's own handler
    if (/app\/api\/(webhooks|jobs)\//.test(file)) {
      if (!/from '@\/lib\/verify'/.test(code))
        problems.push(`${file}: must verify with @/lib/verify`);
      return problems;
    }
    for (const line of exportsOf(code)) {
      if (!new RegExp(`^export const ${METHOD} = route\\(`).test(line)) {
        problems.push(`${file}: "${line}" must be \`export const GET = route(…)\``);
      }
    }
  }
  return problems;
}

describe('guards', () => {
  it('every Server Action and route handler in apps/web goes through action() / route()', () => {
    const problems = [...sources(ROOT)].flatMap((path) =>
      violations(relative(ROOT, path), readFileSync(path, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('catches unguarded exports', () => {
    const action = `'use server';\nexport async function leak() {}\nexport const ok = action(s, h);`;
    expect(violations('actions/x.ts', action)).toHaveLength(1);
    expect(violations('app/page.tsx', `async function f() { 'use server'; }`)).toHaveLength(1);
    expect(violations('app/api/x/route.ts', 'export async function GET() {}')).toHaveLength(1);
    expect(violations('app/api/x/route.ts', 'export const POST = route(s, h);')).toEqual([]);
    expect(violations('app/api/webhooks/gmail/route.ts', 'export const POST = 1')).toHaveLength(1);
  });
});
