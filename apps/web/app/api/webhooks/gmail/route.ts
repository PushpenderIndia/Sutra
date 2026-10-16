import { env } from '@sutra/config';
import { onGmailPush } from '@sutra/mail';
import { z } from 'zod';
import { VerificationError, verifyGoogleOidc } from '@/lib/verify';

const push = z.object({
  message: z.object({ data: z.string(), messageId: z.string().optional() }),
});
const notification = z.object({ emailAddress: z.email(), historyId: z.coerce.string() });

const decode = (data: string): unknown => {
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

/**
 * Gmail push via Pub/Sub: OIDC-verified, then the mailbox's history is synced. Duplicate
 * deliveries are harmless (replies are keyed by Gmail id). A 5xx makes Pub/Sub retry.
 */
export async function POST(request: Request) {
  try {
    await verifyGoogleOidc(request, {
      serviceAccount: env.GMAIL_PUSH_SERVICE_ACCOUNT ?? '',
      audience: `${env.APP_URL}/api/webhooks/gmail`,
    });
  } catch (error) {
    if (error instanceof VerificationError) return new Response('Unauthorized', { status: 401 });
    throw error;
  }
  const body = push.safeParse(await request.json().catch(() => null));
  const data = body.success ? notification.safeParse(decode(body.data.message.data)) : null;
  if (!data?.success) return new Response('Bad request', { status: 400 });
  await onGmailPush(data.data);
  return new Response(null, { status: 204 });
}
