import { Credentials, newId } from '@sutra/db';
import { describe, expect, it } from 'vitest';
import { googleRefreshToken, vaultRefreshToken } from './credentials';

const account = { providerId: 'google', refreshToken: 'refresh-secret', scope: 'openid,email' };

describe('vaultRefreshToken', () => {
  it('stores the refresh token encrypted for the active workspace, never on the account', async () => {
    const workspaceId = newId();
    expect(await vaultRefreshToken(account, 'user-1', workspaceId)).toEqual({
      providerId: 'google',
      scope: 'openid,email',
    });
    const [stored] = await Credentials.find(workspaceId);
    expect(stored).toMatchObject({
      provider: 'google',
      userId: 'user-1',
      scopes: ['openid', 'email'],
    });
    expect(stored?.ciphertext).not.toContain('refresh-secret');
    expect(await googleRefreshToken(workspaceId, 'user-1')).toBe('refresh-secret');

    // Reconnecting replaces it.
    await vaultRefreshToken({ ...account, refreshToken: 'rotated' }, 'user-1', workspaceId);
    expect(await Credentials.count(workspaceId)).toBe(1);
    expect(await googleRefreshToken(workspaceId, 'user-1')).toBe('rotated');
  });

  it('drops the token when there is no active workspace (first sign-in)', async () => {
    const before = await Credentials.col().countDocuments();
    expect(await vaultRefreshToken(account, 'user-1', null)).not.toHaveProperty('refreshToken');
    expect(await Credentials.col().countDocuments()).toBe(before);
  });
});
