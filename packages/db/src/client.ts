import { env } from '@sutra/config';
import { MongoClient } from 'mongodb';

// Cached on globalThis so Next.js hot reloads reuse one pool instead of leaking connections.
const cache = globalThis as typeof globalThis & { sutraMongo?: MongoClient };

/** The shared client. It connects lazily on first use. Atlas M0 allows 500 connections. */
export const mongo = () =>
  (cache.sutraMongo ??= new MongoClient(env.MONGODB_URI, { appName: 'sutra', maxPoolSize: 10 }));

export const db = () => mongo().db(env.MONGODB_DB);

export async function closeDb() {
  await cache.sutraMongo?.close();
  cache.sutraMongo = undefined;
}
