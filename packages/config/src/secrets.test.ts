import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { clientSchema, serverSchema } from './schema.ts';
import { check, envExample, type Gcloud, push } from './secrets.ts';

const root = join(import.meta.dirname, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'sutra-secrets-'));
const validFile = join(tmp, '.env.local');
writeFileSync(validFile, envExample());

/** In-memory Secret Manager that records calls. */
function fakeGcloud(initialVersions: number | null) {
  let versions =
    initialVersions === null ? null : Array.from({ length: initialVersions }, () => true);
  const calls: string[][] = [];
  const run: Gcloud = (args) => {
    calls.push(args);
    const [, a, b, c] = args;
    if (a === 'describe') {
      if (!versions) throw new Error('NOT_FOUND');
      return 'SUTRA_ENV';
    }
    if (a === 'create') versions = [true];
    else if (b === 'add') versions?.push(true);
    else if (b === 'destroy') versions?.splice(Number(c) - 1, 1, false);
    else if (b === 'list')
      return (versions ?? []).flatMap((active, i) => (active ? [`${i + 1}\n`] : [])).join('');
    return '';
  };
  const active = () => (versions ?? []).filter(Boolean).length;
  return { run, calls, active };
}

describe('.env.example', () => {
  it('is exactly what the generator produces (run `pnpm secrets:example`)', () => {
    expect(readFileSync(join(root, '.env.example'), 'utf8')).toBe(envExample());
  });

  it('lists every schema key and passes validation', () => {
    const example = parseEnv(envExample());
    expect(Object.keys(example).sort()).toEqual(
      [...Object.keys(serverSchema.shape), ...Object.keys(clientSchema.shape)].sort(),
    );
    expect(() => check(example)).not.toThrow();
  });
});

describe('push', () => {
  it('leaves exactly one active version, destroying older ones', () => {
    const gcloud = fakeGcloud(3);
    expect(push(gcloud.run, validFile, 'demo')).toBe('4');
    expect(gcloud.active()).toBe(1);
    expect(gcloud.calls.filter((c) => c[2] === 'destroy').map((c) => c[3])).toEqual([
      '3',
      '2',
      '1',
    ]);
    expect(gcloud.calls.every((c) => c.includes('--project=demo'))).toBe(true);
  });

  it('creates the secret when missing', () => {
    const gcloud = fakeGcloud(null);
    expect(push(gcloud.run, validFile)).toBe('1');
    expect(gcloud.calls.some((c) => c[1] === 'create')).toBe(true);
    expect(gcloud.active()).toBe(1);
  });

  it('refuses to upload an invalid env', () => {
    const bad = join(tmp, 'bad.env');
    writeFileSync(bad, 'APP_URL=nope\n');
    const gcloud = fakeGcloud(1);
    expect(() => push(gcloud.run, bad)).toThrow('MONGODB_URI: missing');
    expect(gcloud.calls).toEqual([]);
  });
});
