import 'server-only';
import { env } from '@sutra/config';
import { db, purgeWorkspace } from '@sutra/db';
import { type Account, betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { getSessionFromCtx } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import { ObjectId } from 'mongodb';
import { headers } from 'next/headers';
import { cache } from 'react';
import { vaultRefreshToken } from '@/lib/credentials';

type AccountData = Partial<Account> & Record<string, unknown>;
type HookContext = Parameters<typeof getSessionFromCtx>[0] | null;

/** Moves a Google refresh token out of Better Auth's `account` row into `credentials`. */
async function keepTokenOutOfAccount<T extends AccountData>(data: T, ctx: HookContext) {
  if (!data.refreshToken) return;
  const session = ctx && (await getSessionFromCtx(ctx).catch(() => null));
  const workspaceId: string | undefined = session?.session.activeOrganizationId;
  return { data: await vaultRefreshToken(data, session?.user.id, workspaceId) };
}

export const auth = betterAuth({
  appName: 'Sutra',
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // No client: standalone mongod (local, tests) has no transactions; Better Auth needs none.
  database: mongodbAdapter(db()),
  // Test-only, so session and role logic can be exercised without Google.
  emailAndPassword: { enabled: env.NODE_ENV === 'test' },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Offline + consent so "Connect mailbox" (GOOGLE_MAILBOX_SCOPES) always yields a refresh token.
      accessType: 'offline',
      prompt: 'select_account consent',
    },
  },
  account: { accountLinking: { trustedProviders: ['google'] } },
  databaseHooks: {
    account: {
      create: { before: keepTokenOutOfAccount },
      update: { before: keepTokenOutOfAccount },
    },
    session: {
      create: {
        // Sign-in lands in the user's first workspace.
        async before(session) {
          const member = await db()
            .collection('member')
            .findOne({ userId: new ObjectId(session.userId) }, { sort: { createdAt: 1 } });
          return {
            data: { ...session, activeOrganizationId: member?.organizationId.toHexString() },
          };
        },
      },
    },
  },
  plugins: [
    organization({
      organizationHooks: {
        // Deleting a workspace must delete everything in it. Only an owner reaches this (the
        // plugin's default `organization:delete` permission). Better Auth removes its own org,
        // member and invitation rows; we first purge every Sutra collection keyed by the
        // workspace id, so no path can orphan tenant data.
        beforeDeleteOrganization: async ({ organization }) => {
          await purgeWorkspace(organization.id);
        },
      },
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

/** The current request's session, fetched once per render. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
