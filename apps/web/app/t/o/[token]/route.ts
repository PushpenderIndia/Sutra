import { recordOpen } from '@sutra/mail';
import { clientIp, trackingLimit } from '@/lib/rate-limit';

/** A transparent 1×1 GIF. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/**
 * Open pixel `/t/o/<token>.gif`. Public by design: the signed token is the credential
 * (`recordOpen()` verifies it); a tampered token gets a 404 and records nothing.
 */
export async function GET(request: Request, ctx: RouteContext<'/t/o/[token]'>) {
  const ip = clientIp(request);
  if (!trackingLimit(ip ?? 'unknown')) return new Response('Too many requests', { status: 429 });
  const { token } = await ctx.params;
  const ok = await recordOpen(token.replace(/\.gif$/, ''), {
    userAgent: request.headers.get('user-agent'),
    ip,
  });
  if (!ok) return new Response('Not found', { status: 404 });
  return new Response(GIF, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  });
}
