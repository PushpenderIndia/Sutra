import { env } from '@sutra/config';
import { handleJob, installJobs } from '@/lib/jobs';
import { VerificationError, verifyGoogleOidc } from '@/lib/verify';

installJobs();

/**
 * The one job endpoint. Cloud Tasks posts here with a Google-signed OIDC token for the configured
 * service account; the body is the job payload. In inline/dev there is no external caller, but the
 * OIDC guard still protects the route whenever a service account is configured. A handler error
 * returns 500 so Cloud Tasks retries with back-off.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const serviceAccount = env.JOBS_OIDC_SERVICE_ACCOUNT;
  if (serviceAccount) {
    try {
      await verifyGoogleOidc(request, { serviceAccount });
    } catch (error) {
      if (error instanceof VerificationError) return new Response('Unauthorized', { status: 401 });
      throw error;
    }
  }
  const { name } = await params;
  const payload = await request.json().catch(() => ({}));
  await handleJob(name, payload);
  return new Response(null, { status: 204 });
}
