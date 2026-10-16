import { describe, expect, it } from 'vitest';
import { MASK, maskEmail, redact } from './redact.ts';

describe('maskEmail', () => {
  it('keeps the first local-part char and the domain', () => {
    expect(maskEmail('jane.doe@acme.com')).toBe('j***@acme.com');
  });

  it('masks every email embedded in free text', () => {
    expect(maskEmail('contact alice@x.io or bob@y.co.uk please')).toBe(
      'contact a***@x.io or b***@y.co.uk please',
    );
  });

  it('leaves text without an email untouched', () => {
    expect(maskEmail('no address here')).toBe('no address here');
  });
});

describe('redact', () => {
  it('masks sensitive keys wholesale', () => {
    const out = redact({ apiKey: 'sk-123', password: 'hunter2', nested: { token: 't' } }) as Record<
      string,
      unknown
    >;
    expect(out.apiKey).toBe(MASK);
    expect(out.password).toBe(MASK);
    expect((out.nested as Record<string, unknown>).token).toBe(MASK);
  });

  it('masks email-bearing keys with maskEmail', () => {
    const out = redact({ to: 'lead@prospect.com', from: 'me@acme.com' }) as Record<string, unknown>;
    expect(out.to).toBe('l***@prospect.com');
    expect(out.from).toBe('m***@acme.com');
  });

  it('masks emails inside arbitrary strings and arrays', () => {
    const out = redact({ note: 'reached jane@acme.com', cc: ['a@b.com', 'c@d.com'] }) as Record<
      string,
      unknown
    >;
    expect(out.note).toBe('reached j***@acme.com');
    expect(out.cc).toEqual(['a***@b.com', 'c***@d.com']);
  });

  it('does not mutate its input', () => {
    const input = { email: 'x@y.com', deep: { password: 's' } };
    redact(input);
    expect(input.email).toBe('x@y.com');
    expect(input.deep.password).toBe('s');
  });

  it('handles cycles and dates', () => {
    const cyclic: Record<string, unknown> = { at: new Date('2026-01-01') };
    cyclic.self = cyclic;
    const out = redact(cyclic) as Record<string, unknown>;
    expect(out.at).toBeInstanceOf(Date);
    expect(out.self).toBe('[circular]');
  });

  it('reduces an Error to a masked name/message', () => {
    const out = redact(new Error('failed for user@host.com')) as Record<string, unknown>;
    expect(out).toEqual({ name: 'Error', message: 'failed for u***@host.com' });
  });
});
