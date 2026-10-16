import { recordClick } from '@sutra/mail';
import { clientIp, trackingLimit } from '@/lib/rate-limit';

/**
 * Click redirect `/t/c/<token>`. Public by design: the destination is inside the signed token
 * (`recordClick()` verifies it), so this can't be used as an open redirect.
 */
export async function GET(request: Request, ctx: RouteContext<'/t/c/[token]'>) {
  const ip = clientIp(request);
  if (!trackingLimit(ip ?? 'unknown')) return new Response('Too many requests', { status: 429 });
  const { token } = await ctx.params;
  const url = await recordClick(token, { userAgent: request.headers.get('user-agent'), ip });
  if (!url) return new Response('Not found', { status: 404 });
  return new Response(null, {
    status: 302,
    headers: { location: url, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}
