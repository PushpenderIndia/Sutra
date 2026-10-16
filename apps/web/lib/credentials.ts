import 'server-only';
import { encrypt } from '@sutra/config';
import { Credentials } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { connectMailbox } from '@sutra/mail';

export { googleRefreshToken } from '@sutra/mail';

const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';

type WithTokens = { refreshToken?: string | null; scope?: string | null };

/**
 * Returns `account` without its refresh token, storing the token encrypted in `credentials`
 * for the user's active workspace. Without a signed-in user and active workspace (a first sign-in,
 * which only asks for basic scopes) the token isn't needed and is dropped. Better Auth's
 * `account` row therefore never holds a refresh token in plaintext. A token with Gmail send
 * access ("Connect mailbox") also makes that Gmail the workspace's sending mailbox.
 */
export async function vaultRefreshToken<T extends WithTokens>(
  account: T,
  userId?: string,
  workspaceId?: Id | null,
): Promise<Omit<T, 'refreshToken'>> {
  const { refreshToken, ...rest } = account;
  if (refreshToken && userId && workspaceId) {
    const scopes = account.scope?.split(/[ ,]/).filter(Boolean);
    await Credentials.upsertBy(workspaceId, 'userId', {
      provider: 'google',
      userId,
      ciphertext: encrypt(refreshToken),
      scopes,
    });
    if (scopes?.includes(GMAIL_SEND))
      await connectMailbox(workspaceId, userId).catch((e) => console.error('Connect mailbox', e));
  }
  return rest;
}
