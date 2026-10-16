import type { Db } from 'mongodb';
import { db } from './client.ts';
import { repositories } from './collections.ts';
import { indexes } from './indexes.ts';
import { toMongoSchema } from './json-schema.ts';

/**
 * Creates every collection with a `$jsonSchema` validator generated from its Zod schema
 * (updating it in place if the collection exists), then creates the declared indexes.
 * Safe to run repeatedly.
 */
export async function migrate(database: Db = db()) {
  const existing = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const { name, schema } of repositories) {
    const options = {
      validator: { $jsonSchema: toMongoSchema(schema) },
      validationLevel: 'strict',
      validationAction: 'error',
    } as const;
    if (existing.has(name)) await database.command({ collMod: name, ...options });
    else await database.createCollection(name, options);
    await database
      .collection(name)
      .createIndexes([{ key: { workspaceId: 1, createdAt: -1 } }, ...indexes[name]]);
  }
}
