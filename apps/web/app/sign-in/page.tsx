import { APP_NAME, TAGLINE } from '@sutra/domain';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';
import { GoogleButton } from './google-button';

async function RedirectIfSignedIn() {
  if (await getSession()) redirect('/business');
  return null;
}

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <div className="flex flex-col gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-neutral-500">{TAGLINE}</p>
      </div>
      <Suspense>
        <GoogleButton />
      </Suspense>
    </main>
  );
}
