import { type BaseSessionService, createEvent, InMemorySessionService } from '@google/adk';
import { describe, expect, it } from 'vitest';
import { MongoSessionService } from './adk-session-service.ts';
import { newId } from './repository.ts';

const app = 'sutra';
const text = (t: string) => ({ role: 'user', parts: [{ text: t }] });
const event = (
  t: string,
  opts: { timestamp?: number; stateDelta?: Record<string, unknown>; id?: string } = {},
) =>
  createEvent({
    invocationId: 'inv',
    author: 'user',
    content: text(t),
    ...(opts.id && { id: opts.id }),
    timestamp: opts.timestamp ?? Date.now(),
    actions: { stateDelta: opts.stateDelta ?? {} },
  });
const texts = (s?: { events: { content?: { parts?: { text?: string }[] } }[] }) =>
  s?.events.map((e) => e.content?.parts?.[0]?.text);

/** One behaviour contract, run against ADK's reference implementation and ours. */
function sessionContract(name: string, make: () => BaseSessionService) {
  describe(`${name} session contract`, () => {
    it('creates and gets a session, trimming temp state', async () => {
      const svc = make();
      const created = await svc.createSession({
        appName: app,
        userId: 'u1',
        sessionId: ' s1 ',
        state: { a: 1, 'temp:x': 2 },
      });
      expect(created).toMatchObject({ id: 's1', appName: app, userId: 'u1', events: [] });
      expect(created.state).toEqual({ a: 1 });
      const got = await svc.getSession({ appName: app, userId: 'u1', sessionId: 's1' });
      expect(got).toMatchObject({ id: 's1', state: { a: 1 }, events: [] });
      expect(got?.lastUpdateTime).toBeGreaterThan(0);
    });

    it('generates an id and returns undefined for unknown sessions', async () => {
      const svc = make();
      const s = await svc.createSession({ appName: app, userId: 'u1' });
      expect(s.id).toMatch(/\S+/);
      expect(await svc.getSession({ appName: app, userId: 'u1', sessionId: 'nope' })).toBe(
        undefined,
      );
      expect(await svc.getSession({ appName: app, userId: 'u2', sessionId: s.id })).toBe(undefined);
    });

    it('getOrCreateSession reuses an existing session', async () => {
      const svc = make();
      const a = await svc.getOrCreateSession({ appName: app, userId: 'u1', sessionId: 'goc' });
      await svc.appendEvent({ session: a, event: event('hi') });
      const b = await svc.getOrCreateSession({ appName: app, userId: 'u1', sessionId: 'goc' });
      expect(texts(b)).toEqual(['hi']);
    });

    it('appends events and applies session, app and user state deltas', async () => {
      const svc = make();
      const s = await svc.createSession({ appName: app, userId: 'u1', sessionId: 'st' });
      const stateDelta = { k: 'v', 'dotted.key': 1, 'temp:t': 1, 'app:plan': 'free', 'user:n': 2 };
      await svc.appendEvent({ session: s, event: event('one', { stateDelta }) });
      expect(s.state).toMatchObject({ k: 'v', 'dotted.key': 1 });
      expect(s.state).not.toHaveProperty('temp:t');

      const got = await svc.getSession({ appName: app, userId: 'u1', sessionId: 'st' });
      expect(texts(got)).toEqual(['one']);
      expect(got?.state).toEqual({ k: 'v', 'dotted.key': 1, 'app:plan': 'free', 'user:n': 2 });
      expect(got?.events[0]?.actions.stateDelta).not.toHaveProperty('temp:t');

      const sameUser = await svc.createSession({ appName: app, userId: 'u1' });
      expect(sameUser.state).toEqual({ 'app:plan': 'free', 'user:n': 2 });
      const otherUser = await svc.createSession({ appName: app, userId: 'u2' });
      expect(otherUser.state).toEqual({ 'app:plan': 'free' });
    });

    it('skips partial events and replaces events with the same id', async () => {
      const svc = make();
      const s = await svc.createSession({ appName: app, userId: 'u1', sessionId: 'p' });
      await svc.appendEvent({ session: s, event: { ...event('partial'), partial: true } });
      await svc.appendEvent({ session: s, event: event('first', { id: 'e1' }) });
      await svc.appendEvent({ session: s, event: event('replaced', { id: 'e1' }) });
      const got = await svc.getSession({ appName: app, userId: 'u1', sessionId: 'p' });
      expect(texts(got)).toEqual(['replaced']);
    });

    it('filters by numRecentEvents and afterTimestamp', async () => {
      const svc = make();
      const s = await svc.createSession({ appName: app, userId: 'u1', sessionId: 'f' });
      for (const [i, t] of ['a', 'b', 'c', 'd'].entries())
        await svc.appendEvent({ session: s, event: event(t, { timestamp: 1000 + i }) });
      const get = (config: { numRecentEvents?: number; afterTimestamp?: number }) =>
        svc.getSession({ appName: app, userId: 'u1', sessionId: 'f', config }).then(texts);
      expect(await get({})).toEqual(['a', 'b', 'c', 'd']);
      expect(await get({ numRecentEvents: 2 })).toEqual(['c', 'd']);
      expect(await get({ afterTimestamp: 1001 })).toEqual(['b', 'c', 'd']);
      expect(await get({ numRecentEvents: 2, afterTimestamp: 1003 })).toEqual(['d']);
      const latest = await svc.getSession({ appName: app, userId: 'u1', sessionId: 'f' });
      expect(latest?.lastUpdateTime).toBe(1003);
    });

    it('lists sessions without events or state, with pagination and ordering', async () => {
      const svc = make();
      const listApp = 'list-app';
      for (const [i, id] of ['x', 'y', 'z'].entries()) {
        const s = await svc.createSession({ appName: listApp, userId: 'lu', sessionId: id });
        await svc.appendEvent({ session: s, event: event(id, { timestamp: 5000 - i }) });
      }
      await svc.createSession({
        appName: listApp,
        userId: 'other',
        sessionId: 'w',
        state: { a: 1 },
      });

      const all = await svc.listSessions({ appName: listApp });
      expect(all).toMatchObject({ page: 1, limit: 4, totalItems: 4, totalPages: 1 });
      expect(all.sessions.every((s) => s.events.length === 0)).toBe(true);
      expect(all.sessions.find((s) => s.id === 'w')?.state).toEqual({});

      const mine = await svc.listSessions({ appName: listApp, userId: 'lu', order: 'asc' });
      expect(mine.sessions.map((s) => s.id)).toEqual(['z', 'y', 'x']);
      const page2 = await svc.listSessions({
        appName: listApp,
        userId: 'lu',
        order: 'desc',
        limit: 2,
        page: 2,
      });
      expect(page2).toMatchObject({ page: 2, limit: 2, totalItems: 3, totalPages: 2 });
      expect(page2.sessions.map((s) => s.id)).toEqual(['z']);
      const byOffset = await svc.listSessions({
        appName: listApp,
        userId: 'lu',
        order: 'desc',
        limit: 1,
        offset: 1,
      });
      expect(byOffset).toMatchObject({ page: 2, totalPages: 3 });
      expect(byOffset.sessions.map((s) => s.id)).toEqual(['y']);
      expect(await svc.listSessions({ appName: 'empty' })).toMatchObject({
        sessions: [],
        totalItems: 0,
        totalPages: 0,
      });
    });

    it('deletes a session', async () => {
      const svc = make();
      const s = await svc.createSession({ appName: app, userId: 'u1', sessionId: 'del' });
      await svc.appendEvent({ session: s, event: event('bye') });
      await svc.deleteSession({ appName: app, userId: 'u1', sessionId: 'del' });
      expect(await svc.getSession({ appName: app, userId: 'u1', sessionId: 'del' })).toBe(
        undefined,
      );
    });
  });
}

sessionContract('InMemorySessionService', () => new InMemorySessionService());
sessionContract('MongoSessionService', () => new MongoSessionService(newId()));

describe('MongoSessionService', () => {
  it('keeps history across instances (process restart)', async () => {
    const ws = newId();
    const first = new MongoSessionService(ws);
    const s = await first.createSession({ appName: app, userId: 'u', sessionId: 'lead:1' });
    await first.appendEvent({ session: s, event: event('remember me', { stateDelta: { n: 1 } }) });

    const second = new MongoSessionService(ws);
    const got = await second.getSession({ appName: app, userId: 'u', sessionId: 'lead:1' });
    expect(texts(got)).toEqual(['remember me']);
    expect(got?.state).toEqual({ n: 1 });
  });

  it('isolates workspaces', async () => {
    const a = new MongoSessionService(newId());
    const b = new MongoSessionService(newId());
    await a.createSession({ appName: app, userId: 'u', sessionId: 'shared-key' });
    expect(await b.getSession({ appName: app, userId: 'u', sessionId: 'shared-key' })).toBe(
      undefined,
    );
    expect((await b.listSessions({ appName: app })).totalItems).toBe(0);
  });
});
