import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { EnvError, parse } from './parse.ts';
import { serverSchema } from './schema.ts';
import { envExample } from './secrets.ts';

const valid = parseEnv(envExample());

describe('parse', () => {
  it('accepts a complete env and applies defaults and transforms', () => {
    const env = parse(serverSchema, { ...valid, PLACES_MONTHLY_LIMIT: '50' });
    expect(env.MONGODB_DB).toBe('sutra');
    expect(env.GCP_REGION).toBe('us-central1');
    expect(env.FEATURE_PAID_SOURCES).toBe(false);
    expect(env.PLACES_MONTHLY_LIMIT).toBe(50);
    expect(env.GMAIL_PUBSUB_TOPIC).toBeUndefined();
  });

  it('lists every missing and invalid key in one error', () => {
    const { MONGODB_URI: _, GEMINI_API_KEY: __, ...rest } = valid;
    const run = () =>
      parse(serverSchema, { ...rest, APP_URL: 'not a url', TRACKING_SECRET: 'short' });
    expect(run).toThrow(EnvError);
    const message = (() => {
      try {
        run();
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message).toMatch(/^Invalid environment configuration:/);
    expect(message).toContain('MONGODB_URI: missing');
    expect(message).toContain('GEMINI_API_KEY: missing');
    expect(message).toMatch(/APP_URL: .+/);
    expect(message).toMatch(/TRACKING_SECRET: .+/);
  });

  it('treats empty values as unset', () => {
    expect(() => parse(serverSchema, { ...valid, MONGODB_URI: '' })).toThrow(
      'MONGODB_URI: missing',
    );
    expect(parse(serverSchema, { ...valid, MONGODB_DB: '' }).MONGODB_DB).toBe('sutra');
  });

  it('rejects a malformed encryption keyring', () => {
    expect(() => parse(serverSchema, { ...valid, ENCRYPTION_KEY: 'abc' })).toThrow(
      'ENCRYPTION_KEY',
    );
  });
});
