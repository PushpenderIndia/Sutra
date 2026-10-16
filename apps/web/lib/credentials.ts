import 'server-only';
import { decrypt, encrypt } from '@sutra/config';
import { Credentials } from '@sutra/db';
import type { Id } from '@sutra/domain';

type WithTokens = { refreshToken?: string | null; scope?: string | null };

/**
 * Returns `account` without its refresh token, storing the token encrypted in `credentials`
 * for the user's active workspace. Without a signed-in user and active workspace (a first sign-in,
 * which only asks for basic scopes) the token isn't needed and is dropped. Better Auth's
 * `account` row therefore never holds a refresh token in plaintext.
 */
export async function vaultRefreshToken<T extends WithTokens>(
  account: T,
  userId?: string,
  workspaceId?: Id | null,
): Promise<Omit<T, 'refreshToken'>> {
  const { refreshToken, ...rest } = account;
  if (refreshToken && userId && workspaceId) {
    await Credentials.upsertBy(workspaceId, 'userId', {
      provider: 'google',
      userId,
      ciphertext: encrypt(refreshToken),
      scopes: account.scope?.split(/[ ,]/).filter(Boolean),
    });
  }
  return rest;
}

/** The user's Google refresh token for a workspace, if they connected their mailbox. */
export async function googleRefreshToken(workspaceId: Id, userId: string) {
  const credential = await Credentials.findOne(workspaceId, { provider: 'google', userId });
  return credential && decrypt(credential.ciphertext);
}
