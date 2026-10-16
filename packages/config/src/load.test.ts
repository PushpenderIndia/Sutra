import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSource } from './load.ts';

describe('loadSource', () => {
  it('merges the mounted secret file over process.env', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sutra-env-')), '.env');
    writeFileSync(file, 'MONGODB_URI=mongodb://mounted\nGEMINI_API_KEY=from-file\n');
    const source = loadSource({
      SUTRA_ENV_FILE: file,
      MONGODB_URI: 'mongodb://env',
      OTHER: 'kept',
    });
    expect(source).toMatchObject({
      MONGODB_URI: 'mongodb://mounted',
      GEMINI_API_KEY: 'from-file',
      OTHER: 'kept',
    });
  });

  it('ignores a missing mounted file', () => {
    expect(loadSource({ SUTRA_ENV_FILE: '/nonexistent/.env', A: '1' }).A).toBe('1');
  });
});
