import { describe, expect, it } from 'vitest';
import { db } from './client.ts';
import { Companies, Contacts, Messages, repositories } from './collections.ts';
import { indexes } from './indexes.ts';
import { migrate } from './migrate.ts';
import { newId } from './repository.ts';

const snapshot = async () =>
  Promise.all(
    repositories.map(async ({ name }) => ({
      name,
      indexes: await db().collection(name).indexes(),
      options: (await db().listCollections({ name }, { nameOnly: false }).next())?.options,
    })),
  );

describe('migrate', () => {
  it('creates every collection with a validator and its indexes, idempotently', async () => {
    await migrate();
    const first = await snapshot();
    await migrate();
    expect(await snapshot()).toEqual(first);
    for (const { name, indexes: created, options } of first) {
      expect(options?.validator?.$jsonSchema, name).toBeDefined();
      // _id + the default workspace listing index + the declared ones.
      expect(created, name).toHaveLength(2 + indexes[name].length);
    }
  });

  it('rejects documents that bypass the repository with an invalid shape', async () => {
    await migrate();
    await expect(
      Contacts.col().insertOne({ _id: newId(), workspaceId: newId(), email: 42 } as never),
    ).rejects.toThrow(/validation/i);
  });

  it('enforces unique keys', async () => {
    await migrate();
    const ws = newId();
    const company = {
      name: 'Kopi',
      normalizedName: 'kopi',
      domain: 'kopi.example',
      country: 'ID',
      sources: [{ source: 'csv' as const, ref: 'row 1', at: new Date() }],
    };
    await Companies.create(ws, company);
    await expect(Companies.create(ws, company)).rejects.toThrow(/duplicate key/);
    await Companies.create(newId(), company);
    const { domain: _, ...noDomain } = company;
    await Companies.create(ws, noDomain);
    await Companies.create(ws, noDomain);

    const message = {
      contactId: newId(),
      direction: 'outbound' as const,
      status: 'queued' as const,
      subject: 's',
      body: 'b',
      idempotencyKey: 'enr:1:step:0',
    };
    await Messages.create(ws, message);
    await expect(Messages.create(ws, message)).rejects.toThrow(/duplicate key/);
  });
});
