import { Messages, migrate, TrackingEvents } from '@sutra/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { recorder, T0, workspace } from '../test/fixtures.ts';
import { deliver } from './send.ts';
import {
  clickToken,
  isMachine,
  openToken,
  recordClick,
  recordOpen,
  trackingFor,
} from './tracking.ts';

beforeAll(() => migrate());

async function sentMessage() {
  const w = await workspace();
  const m = await w.queue();
  await deliver(w.ws, m._id, { now: T0, client: recorder(w.mailbox).client });
  return {
    ...w,
    message: (await Messages.get(w.ws, m._id)) as NonNullable<
      Awaited<ReturnType<typeof Messages.get>>
    >,
  };
}
const human = {
  userAgent: 'Mozilla/5.0 (Macintosh)',
  ip: '203.0.113.7',
  at: new Date(T0.getTime() + 60_000),
};
const tamper = (token: string) => `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;

describe('tracking tokens', () => {
  it('carry ids and the URL only, no address', async () => {
    const { ws, message } = await sentMessage();
    const { pixel, click } = trackingFor(ws, message._id);
    expect(pixel).toMatch(/^http:\/\/localhost:3000\/t\/o\/[\w-]+\.[\w-]+\.gif$/);
    const decoded = Buffer.from(
      click('https://p.example/x').split('/t/c/')[1]?.split('.')[0] ?? '',
      'base64url',
    ).toString();
    expect(decoded).toBe(`c:${ws}:${message._id}:https://p.example/x`);
    expect(decoded).not.toContain('@');
  });

  it('records a human open and a click with the variant, and returns the destination', async () => {
    const { ws, message, variant } = await sentMessage();
    expect(await recordOpen(openToken(ws, message._id), human)).toBe(true);
    expect(await recordClick(clickToken(ws, message._id, 'https://p.example/x'), human)).toBe(
      'https://p.example/x',
    );
    const events = await TrackingEvents.find(
      ws,
      { messageId: message._id },
      { sort: { kind: -1 } },
    );
    expect(events).toMatchObject([
      { kind: 'open', machine: false, variantId: variant.id },
      { kind: 'click', machine: false, url: 'https://p.example/x' },
    ]);
  });

  it('records nothing for tampered, foreign or unknown tokens', async () => {
    const { ws, message } = await sentMessage();
    expect(await recordOpen(tamper(openToken(ws, message._id)))).toBe(false);
    expect(await recordClick(tamper(clickToken(ws, message._id, 'https://p.example')))).toBeNull();
    expect(await recordOpen('garbage')).toBe(false);
    // A click token can't be used as an open token, and vice versa.
    expect(await recordOpen(clickToken(ws, message._id, 'https://p.example'))).toBe(false);
    expect(await recordClick(openToken(ws, message._id))).toBeNull();
    // Validly signed, but another workspace's id.
    expect(await recordOpen(openToken('64656d6f00000000000000ff', message._id))).toBe(false);
    expect(await TrackingEvents.count(ws)).toBe(0);
  });
});

describe('machine-open filter', () => {
  it('flags hits within 10s of sending, proxy agents and Apple proxy IPs', () => {
    const at = (s: number) => new Date(T0.getTime() + s * 1000);
    expect(isMachine(T0, { at: at(5) })).toBe(true);
    expect(
      isMachine(T0, { at: at(60), userAgent: 'Mozilla/5.0 via ggpht.com GoogleImageProxy' }),
    ).toBe(true);
    expect(isMachine(T0, { at: at(60), ip: '17.58.1.2' })).toBe(true);
    expect(isMachine(T0, { at: at(60), ip: '::ffff:17.0.0.1' })).toBe(true);
    expect(isMachine(T0, { at: at(60), ip: '18.0.0.1', userAgent: 'Mozilla/5.0 (iPhone)' })).toBe(
      false,
    );
  });
});
