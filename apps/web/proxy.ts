import { getSessionCookie } from 'better-auth/cookies';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Optimistic gate: no session cookie → `/sign-in`. It only reads the cookie; pages and
 * actions verify the session itself (`(app)/layout.tsx`, `action()`, `route()`).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL('/sign-in', request.url);
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except `/`, `/sign-in`, `/api/*` (guarded by route() or lib/verify), Next internals
  // and static files.
  matcher: ['/((?!api/|_next/|sign-in|.*\\.[a-z0-9]+$).+)'],
};
