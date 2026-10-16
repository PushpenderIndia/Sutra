import { describe, expect, it } from 'vitest';
import { buildSubmitArgs, isFreeRegion } from './deploy.ts';

describe('buildSubmitArgs', () => {
  it('builds the gcloud builds submit argv', () => {
    expect(buildSubmitArgs({ project: 'sutra-demo', region: 'us-central1' })).toEqual([
      'builds',
      'submit',
      '--project=sutra-demo',
      '--region=us-central1',
      '--config=infra/cloudbuild.yaml',
      '--substitutions=_REGION=us-central1',
      '.',
    ]);
  });

  it('honours a custom config and source', () => {
    const args = buildSubmitArgs({
      project: 'p',
      region: 'us-east1',
      config: 'infra/other.yaml',
      source: './dist',
    });
    expect(args).toContain('--config=infra/other.yaml');
    expect(args.at(-1)).toBe('./dist');
  });

  it('rejects a non-free region (would leave the always-free tier)', () => {
    expect(() => buildSubmitArgs({ project: 'p', region: 'europe-west1' })).toThrow(/always-free/);
  });

  it('requires a project', () => {
    expect(() => buildSubmitArgs({ project: '', region: 'us-central1' })).toThrow(/GCP_PROJECT_ID/);
  });
});

describe('isFreeRegion', () => {
  it('accepts only the always-free Cloud Run regions', () => {
    expect(isFreeRegion('us-central1')).toBe(true);
    expect(isFreeRegion('us-east1')).toBe(true);
    expect(isFreeRegion('us-west1')).toBe(true);
    expect(isFreeRegion('europe-west1')).toBe(false);
    expect(isFreeRegion('')).toBe(false);
  });
});
