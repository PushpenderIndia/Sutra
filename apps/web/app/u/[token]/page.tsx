import { unsubscribeTarget } from '@sutra/db';
import type { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false } };

/** `ana@acme.com` → `a***@acme.com`: confirms the address without spelling it out. */
const mask = (email: string) => email.replace(/^(.)[^@]*/, '$1***');

/**
 * The footer unsubscribe link. Mail scanners prefetch links, so GET only asks for
 * confirmation; the button POSTs to the one-click endpoint, which redirects back here.
 */
async function Unsubscribe({ params }: Pick<PageProps<'/u/[token]'>, 'params'>) {
  const { token } = await params;
  const target = await unsubscribeTarget(token);
  if (!target) return <p>This unsubscribe link is invalid.</p>;
  const sender = target.senderName || 'this sender';
  const email = mask(target.contact.email);
  if (target.contact.status === 'suppressed')
    return (
      <p>
        You're unsubscribed. You won't get more emails from {sender} at {email}.
      </p>
    );
  return (
    <form
      method="post"
      action={`/u/${token}/one-click`}
      className="flex flex-col items-center gap-4"
    >
      <p>
        Stop emails from {sender} to {email}?
      </p>
      <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-white">
        Unsubscribe
      </button>
    </form>
  );
}

export default function Page({ params }: PageProps<'/u/[token]'>) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <Suspense fallback={<p>Loading…</p>}>
        <Unsubscribe params={params} />
      </Suspense>
    </main>
  );
}
