import { unsubscribe } from '@sutra/db';

/**
 * Public by design: the signed token is the credential (`unsubscribe()` verifies it).
 * RFC 8058 one-click: mail providers POST `List-Unsubscribe=One-Click` and get a status code.
 * The confirm button on `/u/[token]` POSTs an empty form and is redirected back to that page.
 */
export async function POST(request: Request, ctx: RouteContext<'/u/[token]/one-click'>) {
  const { token } = await ctx.params;
  const oneClick = (await request.text()).includes('List-Unsubscribe=One-Click');
  const ok = await unsubscribe(token, oneClick ? 'list_unsubscribe' : 'footer_link');
  if (!oneClick) return Response.redirect(new URL(`/u/${token}`, request.url), 303);
  return new Response(ok ? 'Unsubscribed' : 'Not found', { status: ok ? 200 : 404 });
}
