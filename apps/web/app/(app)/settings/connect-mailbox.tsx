'use client';
import { GOOGLE_MAILBOX_SCOPES } from '@sutra/domain';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

/** Incremental Google consent for Gmail send/read and Calendar; the token lands in `credentials`. */
export function ConnectMailbox({ label = 'Connect mailbox' }: { label?: string }) {
  const [pending, setPending] = useState(false);
  async function connect() {
    setPending(true);
    await authClient.linkSocial({
      provider: 'google',
      scopes: GOOGLE_MAILBOX_SCOPES,
      callbackURL: '/settings',
    });
  }
  return (
    <button
      type="button"
      onClick={connect}
      disabled={pending}
      className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
    >
      {pending ? 'Redirecting…' : label}
    </button>
  );
}
