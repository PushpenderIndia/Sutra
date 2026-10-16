import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditInfra } from './audit.ts';

// packages/deploy/src → repo root → infra
const INFRA = join(import.meta.dirname, '..', '..', '..', 'infra');

describe('auditInfra', () => {
  it('the committed infra satisfies every free-tier invariant', () => {
    expect(auditInfra(INFRA)).toEqual([]);
  });

  it('flags an infra tree that is missing files', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sutra-infra-'));
    const problems = auditInfra(empty);
    expect(problems).toContain('missing terraform/main.tf');
    expect(problems.length).toBeGreaterThan(5);
  });

  it('flags a non-free region default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sutra-infra-'));
    const tfDir = join(dir, 'terraform');
    mkdirSync(tfDir, { recursive: true });
    // A variables.tf that defaults to a paid region.
    writeFileSync(join(tfDir, 'variables.tf'), 'variable "region" { default = "europe-west1" }');
    writeFileSync(join(tfDir, 'main.tf'), '');
    expect(auditInfra(dir)).toContain('terraform: region default must be "us-central1"');
  });
});
