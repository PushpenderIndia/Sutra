import { z } from 'zod';

/** Documents a key: `description` and `example` feed the generated `.env.example`. */
const doc = <T extends z.ZodType>(schema: T, description: string, example = '') =>
  schema.meta({ description, example });

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

/** One or more `version:base64(32 bytes)` keys, comma-separated. The first one encrypts. */
export const KEYRING_PATTERN = /^v\d+:[A-Za-z0-9+/]{43}=(,v\d+:[A-Za-z0-9+/]{43}=)*$/;

export const serverSchema = z.object({
  NODE_ENV: doc(
    z.enum(['development', 'test', 'production']).default('development'),
    'Runtime mode',
  ),
  APP_URL: doc(z.url(), 'Public base URL of the app', 'http://localhost:3000'),

  MONGODB_URI: doc(
    z.string().startsWith('mongodb'),
    'MongoDB connection string (Atlas M0 in prod)',
    'mongodb://localhost:27017',
  ),
  MONGODB_DB: doc(z.string().default('sutra'), 'MongoDB database name'),

  BETTER_AUTH_SECRET: doc(
    z.string().min(32),
    'Session signing secret, at least 32 chars (openssl rand -base64 32)',
    'replace-me-with-openssl-rand-base64-32',
  ),
  GOOGLE_CLIENT_ID: doc(
    z.string(),
    'Google OAuth client ID',
    'replace-me.apps.googleusercontent.com',
  ),
  GOOGLE_CLIENT_SECRET: doc(z.string(), 'Google OAuth client secret', 'replace-me'),

  GCP_PROJECT_ID: doc(z.string(), 'Google Cloud project ID', 'replace-me'),
  GCP_REGION: doc(z.string().default('us-central1'), 'Cloud Run region, free tier'),
  ENCRYPTION_KEY: doc(
    z.string().regex(KEYRING_PATTERN, 'expected "v1:<base64 of 32 bytes>[,v0:<...>]"'),
    'Tenant credential keyring "v1:<openssl rand -base64 32>"; prepend a new version to rotate',
    'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ),
  GOOGLE_MAPS_API_KEY: doc(z.string(), 'Places API key', 'replace-me'),
  PLACES_MONTHLY_LIMIT: doc(
    z.coerce.number().int().positive().default(900),
    'Monthly Places request cap, kept under the free tier',
  ),

  LITELLM_BASE_URL: doc(z.url(), 'LiteLLM proxy base URL', 'http://localhost:4000'),
  LITELLM_API_KEY: doc(z.string(), 'LiteLLM proxy master key', 'replace-me'),
  GEMINI_API_KEY: doc(
    z.string(),
    'AI Studio key from a project WITHOUT billing (free tier only)',
    'replace-me',
  ),

  GMAIL_PUBSUB_TOPIC: doc(z.string().optional(), 'Pub/Sub topic for Gmail push notifications'),
  TRACKING_SECRET: doc(
    z.string().min(32),
    'Signs open/click/unsubscribe tokens, at least 32 chars',
    'replace-me-with-openssl-rand-base64-32',
  ),

  JOBS_DRIVER: doc(z.enum(['inline', 'cloud-tasks']).default('inline'), 'Background job driver'),
  CLOUD_TASKS_QUEUE: doc(
    z.string().optional(),
    'Cloud Tasks queue name for the cloud-tasks driver',
  ),
  JOBS_OIDC_SERVICE_ACCOUNT: doc(
    z.string().optional(),
    'Service account Cloud Tasks uses to sign job requests',
  ),

  FEATURE_PAID_SOURCES: doc(bool.default(false), 'Allow workspaces to enable Apollo/Hunter'),
  FAKE_MAIL: doc(bool.default(false), 'Demo mode: simulate sends, opens, clicks and replies'),
});

export const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: doc(
    z.url(),
    'Public base URL exposed to the browser',
    'http://localhost:3000',
  ),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;
