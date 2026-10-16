import { BASE_KEYS, type base, canTransition, type Id, type TransitionTable } from '@sutra/domain';
import { type Collection, type Document, type Filter, type FindOptions, ObjectId } from 'mongodb';
import type { z } from 'zod';
import { db } from './client.ts';
import { InvalidTransitionError } from './errors.ts';

type BaseKey = keyof typeof base;
type DocSchema = z.ZodObject<typeof base & z.ZodRawShape>;

/** What callers provide: everything except the stamped `_id`, `workspaceId` and dates. */
export type Input<S extends DocSchema> = Omit<z.input<S>, BaseKey>;
export type Patch<S extends DocSchema> = Partial<Input<S>>;

export const newId = () => new ObjectId().toHexString();

/**
 * A typed, validated, tenant-scoped data access object for one collection.
 * Every method takes `workspaceId` first and adds it to the filter, so there is no way to
 * read or write another workspace's documents through it.
 */
export function repository<const N extends string, S extends DocSchema>(name: N, schema: S) {
  type Doc = z.infer<S>;
  /** Typed escape hatch for aggregations; callers must scope by `workspaceId` themselves. */
  const col = (): Collection<Doc> => db().collection<Doc>(name);
  // Internally untyped: the generic `Doc` defeats the driver's filter/update types.
  const raw = () => db().collection(name);
  const scoped = (workspaceId: Id, filter: Filter<Doc> | Document = {}): Document => ({
    ...filter,
    workspaceId,
  });
  const byId = (workspaceId: Id, id: Id) => scoped(workspaceId, { _id: id });
  const after = { returnDocument: 'after' } as const;

  const stamp = (workspaceId: Id, data: Input<S>, now = new Date()): Doc =>
    schema.parse({ ...data, _id: newId(), workspaceId, createdAt: now, updatedAt: now });

  /** Validates only the keys present; `undefined` values become `$unset`. */
  function toUpdate(patch: Patch<S>): Document {
    const keys = Object.keys(patch).filter(
      (k) => k in schema.shape && !(BASE_KEYS as string[]).includes(k),
    );
    const values = patch as Record<string, unknown>;
    const set = keys.filter((k) => values[k] !== undefined);
    const unset = keys.filter((k) => values[k] === undefined);
    const parsed = schema
      .pick(Object.fromEntries(set.map((k) => [k, true])) as Record<string, true>)
      .parse(values) as Record<string, unknown>;
    return {
      $set: { ...parsed, updatedAt: new Date() },
      ...(unset.length && { $unset: Object.fromEntries(unset.map((k) => [k, ''])) }),
    };
  }

  return {
    name,
    schema,
    col,

    async create(workspaceId: Id, data: Input<S>): Promise<Doc> {
      const doc = stamp(workspaceId, data);
      await raw().insertOne(doc);
      return doc;
    },

    async createMany(workspaceId: Id, data: Input<S>[]): Promise<Doc[]> {
      const now = new Date();
      const docs = data.map((d) => stamp(workspaceId, d, now));
      if (docs.length) await raw().insertMany(docs);
      return docs;
    },

    get: (workspaceId: Id, id: Id) => raw().findOne(byId(workspaceId, id)) as Promise<Doc | null>,

    find: (workspaceId: Id, filter: Filter<Doc> = {}, opts?: FindOptions) =>
      raw().find(scoped(workspaceId, filter), opts).toArray() as Promise<Doc[]>,

    findOne: (workspaceId: Id, filter: Filter<Doc>) =>
      raw().findOne(scoped(workspaceId, filter)) as Promise<Doc | null>,

    count: (workspaceId: Id, filter: Filter<Doc> = {}) =>
      raw().countDocuments(scoped(workspaceId, filter)),

    update: async (workspaceId: Id, id: Id, patch: Patch<S>) =>
      raw().findOneAndUpdate(byId(workspaceId, id), toUpdate(patch), after) as Promise<Doc | null>,

    /**
     * Atomic, guarded status change: matches only while the status is still `from`, so of two
     * concurrent callers exactly one gets the document and the other gets `null`.
     * Throws if `table` doesn't allow `from → to`. `patch` is applied in the same write.
     */
    async transition<St extends string>(
      workspaceId: Id,
      id: Id,
      from: St,
      to: St,
      table: TransitionTable<St>,
      patch: Patch<S> = {},
    ): Promise<Doc | null> {
      if (!canTransition(table, from, to)) throw new InvalidTransitionError(name, from, to);
      const update = toUpdate({ ...patch, status: to } as Patch<S>);
      const filter = scoped(workspaceId, { _id: id, status: from });
      return raw().findOneAndUpdate(filter, update, after) as Promise<Doc | null>;
    },

    /** Inserts, or replaces the fields of, the document whose `key` equals `data[key]`. */
    async upsertBy<K extends keyof Input<S> & string>(
      workspaceId: Id,
      key: K,
      data: Input<S>,
    ): Promise<Doc> {
      const { _id, createdAt, updatedAt, ...fields } = stamp(workspaceId, data) as Document;
      const filter = scoped(workspaceId, { [key]: fields[key] });
      const update = { $set: { ...fields, updatedAt }, $setOnInsert: { _id, createdAt } };
      return raw().findOneAndUpdate(filter, update, { ...after, upsert: true }) as Promise<Doc>;
    },

    remove: async (workspaceId: Id, id: Id) =>
      (await raw().deleteOne(byId(workspaceId, id))).deletedCount === 1,
  };
}

export type Repository = ReturnType<typeof repository>;
