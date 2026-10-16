'use client';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function GoogleButton() {
  const next = useSearchParams().get('next');
  const [pending, setPending] = useState(false);
  async function signIn() {
    setPending(true);
    await authClient.signIn.social({
      provider: 'google',
      // Only same-site paths, so `?next=` can't redirect off-site.
      callbackURL: next?.startsWith('/') && !next.startsWith('//') ? next : '/business',
      newUserCallbackURL: '/onboarding',
      errorCallbackURL: '/sign-in',
    });
  }
  return (
    <button
      type="button"
      onClick={signIn}
      disabled={pending}
      className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
    >
      {pending ? 'Redirecting…' : 'Continue with Google'}
    </button>
  );
}
