import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';
import { authLimit, clientIp } from '@/lib/rate-limit';

const handlers = toNextJsHandler(auth);

/** Per-IP rate limit on the unauthenticated auth endpoints (PR 18 hardening), then Better Auth. */
const limited =
  (handler: (request: Request) => Promise<Response>) =>
  (request: Request): Promise<Response> => {
    if (!authLimit(clientIp(request) ?? 'unknown'))
      return Promise.resolve(new Response('Too many requests', { status: 429 }));
    return handler(request);
  };

export const GET = limited(handlers.GET);
export const POST = limited(handlers.POST);
