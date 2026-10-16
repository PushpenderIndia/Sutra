import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  type AppendEventRequest,
  BaseSessionService,
  type CreateSessionRequest,
  createSession,
  type DeleteSessionRequest,
  type Event,
  type GetSessionRequest,
  type ListSessionsRequest,
  type ListSessionsResponse,
  mergeStates,
  type Session,
  State,
  trimTempState,
} from '@google/adk';
import type { AdkSession, Id } from '@sutra/domain';
import type { Document } from 'mongodb';
import { AdkEvents, AdkSessions, AdkState } from './collections.ts';
import { newId } from './repository.ts';

type Scope = 'app' | 'user';
const PREFIX: Record<Scope, string> = { app: State.APP_PREFIX, user: State.USER_PREFIX };

/** Pipeline update that sets each key of `values` on `field`, safe for keys with `.` or `$`. */
const setFields = (field: string, values: Record<string, unknown>): Document =>
  Object.entries(values).reduce<Document>(
    (input, [key, value]) => ({ $setField: { field: key, input, value: { $literal: value } } }),
    { $ifNull: [`$${field}`, {}] },
  );

/** Strips `undefined` and class instances so stored events read back as plain JSON. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * ADK sessions stored in MongoDB (`adk_sessions`, `adk_events`, `adk_state`), scoped to one
 * workspace. Behaves like ADK's `InMemorySessionService` (see the shared contract tests), so
 * a run can stop and resume on another instance with its history intact. Imported from
 * `@sutra/db/adk` so code that only needs the repositories doesn't bundle ADK.
 */
export class MongoSessionService extends BaseSessionService {
  readonly workspaceId: Id;

  constructor(workspaceId: Id) {
    super();
    this.workspaceId = workspaceId;
  }

  private key = ({ appName, userId, sessionId }: DeleteSessionRequest) => ({
    workspaceId: this.workspaceId,
    appName,
    userId,
    sessionId,
  });

  private async scopedState(appName: string, userId: string) {
    const docs = await AdkState.find(this.workspaceId, {
      appName,
      $or: [{ scope: 'app' }, { scope: 'user', userId }],
    });
    const of = (scope: Scope) => docs.find((d) => d.scope === scope)?.state;
    return mergeStates(of('app'), of('user'), {});
  }

  private async toSession(doc: AdkSession, events: Event[] = []): Promise<Session> {
    return createSession({
      id: doc.sessionId,
      appName: doc.appName,
      userId: doc.userId,
      state: { ...doc.state, ...(await this.scopedState(doc.appName, doc.userId)) },
      events,
      lastUpdateTime: doc.lastUpdateTime,
    });
  }

  async createSession({ appName, userId, state, sessionId }: CreateSessionRequest) {
    const doc = await AdkSessions.create(this.workspaceId, {
      appName,
      userId,
      sessionId: sessionId?.trim() || randomUUID(),
      state: plain(state ? { ...trimTempState(state) } : {}),
      lastUpdateTime: Date.now(),
    });
    return this.toSession(doc);
  }

  async getSession({ config, ...key }: GetSessionRequest) {
    const doc = (await AdkSessions.col().findOne(this.key(key))) as AdkSession | null;
    if (!doc) return undefined;
    const filter: Document = { workspaceId: this.workspaceId, sessionId: doc._id };
    if (config?.afterTimestamp) filter.timestamp = { $gte: config.afterTimestamp };
    const recent = config?.numRecentEvents;
    const cursor = AdkEvents.col()
      .find(filter)
      .sort({ timestamp: recent ? -1 : 1, _id: recent ? -1 : 1 });
    if (recent) cursor.limit(recent);
    const events = (await cursor.toArray()).map((e) => e.event as unknown as Event);
    return this.toSession(doc, recent ? events.reverse() : events);
  }

  async listSessions({
    appName,
    userId,
    limit,
    offset = 0,
    page,
    order,
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    const filter = {
      workspaceId: this.workspaceId,
      appName,
      ...(userId !== undefined && { userId }),
    };
    const totalItems = await AdkSessions.col().countDocuments(filter);
    const skip = limit !== undefined && page !== undefined ? (page - 1) * limit : offset;
    const cursor = AdkSessions.col().find(filter).skip(skip);
    if (order) cursor.sort({ lastUpdateTime: order === 'asc' ? 1 : -1, sessionId: 1 });
    if (limit) cursor.limit(limit);
    const docs = limit === 0 ? [] : await cursor.toArray();
    const sessions = docs.map((d) =>
      createSession({
        id: d.sessionId,
        appName: d.appName,
        userId: d.userId,
        lastUpdateTime: d.lastUpdateTime,
      }),
    );
    if (limit === undefined)
      return { sessions, page: 1, limit: totalItems, totalItems, totalPages: totalItems ? 1 : 0 };
    return {
      sessions,
      page: page ?? (limit === 0 ? 1 : Math.floor(skip / limit) + 1),
      limit,
      totalItems,
      totalPages: limit === 0 ? 0 : Math.ceil(totalItems / limit),
    };
  }

  async deleteSession(key: DeleteSessionRequest) {
    const doc = await AdkSessions.col().findOneAndDelete(this.key(key));
    if (doc)
      await AdkEvents.col().deleteMany({ workspaceId: this.workspaceId, sessionId: doc._id });
  }

  override async appendEvent({ session, event }: AppendEventRequest) {
    if (event.partial) return event;
    const appended = await super.appendEvent({ session, event });
    session.lastUpdateTime = appended.timestamp;

    const delta = appended.actions?.stateDelta ?? {};
    const doc = await AdkSessions.col().findOneAndUpdate(
      this.key({ appName: session.appName, userId: session.userId, sessionId: session.id }),
      [{ $set: { state: setFields('state', plain(delta)), lastUpdateTime: appended.timestamp } }],
    );
    if (!doc) return appended;

    for (const scope of ['app', 'user'] as const) {
      const prefix = PREFIX[scope];
      const values = Object.fromEntries(
        Object.entries(delta)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
      if (!Object.keys(values).length) continue;
      const filter = {
        workspaceId: this.workspaceId,
        appName: session.appName,
        scope,
        ...(scope === 'user' && { userId: session.userId }),
      };
      const now = new Date();
      const insert = { _id: newId(), state: {}, createdAt: now };
      await AdkState.col().updateOne(filter, { $setOnInsert: insert }, { upsert: true });
      await AdkState.col().updateOne(filter, [
        { $set: { state: setFields('state', plain(values)), updatedAt: now } },
      ]);
    }

    const now = new Date();
    const fields = {
      workspaceId: this.workspaceId,
      sessionId: doc._id,
      invocationId: appended.invocationId,
      author: appended.author ?? '',
      timestamp: appended.timestamp,
      event: plain(appended) as unknown as Record<string, unknown>,
      updatedAt: now,
    };
    // Re-appending an event with the same id replaces it, as ADK's base service does.
    const replaced = await AdkEvents.col().findOneAndReplace(
      { workspaceId: this.workspaceId, sessionId: doc._id, 'event.id': appended.id },
      { ...fields, createdAt: now },
    );
    if (!replaced) await AdkEvents.col().insertOne({ _id: newId(), ...fields, createdAt: now });
    return appended;
  }
}
