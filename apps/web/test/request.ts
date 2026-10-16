import { auth } from '@/lib/auth';

/** The request the mocked `next/headers` returns. */
export const request = { headers: new Headers() };

/** Makes the following Server Action calls come from `headers` (anonymous by default). */
export const as = (headers = new Headers()) => {
  request.headers = headers;
};

const cookieHeader = (headers: Headers) =>
  new Headers({
    cookie: headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  });

/** Signs up a user with email/password (enabled in tests only) and returns their cookie headers. */
export async function signUp(email: string) {
  const body = { email, password: 'correct-horse-battery', name: email.split('@')[0] ?? email };
  const { headers, response } = await auth.api.signUpEmail({ body, returnHeaders: true });
  return { user: response.user, headers: cookieHeader(headers) };
}

export async function signIn(email: string) {
  const body = { email, password: 'correct-horse-battery' };
  const { headers } = await auth.api.signInEmail({ body, returnHeaders: true });
  return cookieHeader(headers);
}
