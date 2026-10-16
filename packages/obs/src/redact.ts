/**
 * PII redaction for logs (PR 18 hardening: "PII redaction in logs — emails masked"). A pure,
 * dependency-free pass applied by the logger before anything is written, so an email address never
 * reaches Cloud Logging in the clear, whether it sits under a known key or is embedded in free text.
 */

export const MASK = '[redacted]';

/** Keys whose value is always masked wholesale (case-insensitive), wherever they appear. */
export const SENSITIVE_KEYS = new Set(
  [
    'password',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'setCookie',
    'accessToken',
    'refreshToken',
    'clientSecret',
    'privateKey',
  ].map((k) => k.toLowerCase()),
);

/** Keys that hold an email address, masked with {@link maskEmail} (so the domain stays debuggable). */
export const EMAIL_KEYS = new Set(
  ['email', 'to', 'from', 'cc', 'bcc', 'replyTo', 'recipient', 'sender'].map((k) =>
    k.toLowerCase(),
  ),
);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** `jane.doe@acme.com` → `j***@acme.com`: keeps the first local-part char and the domain. */
export function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, (match) => {
    const at = match.indexOf('@');
    const local = match.slice(0, at);
    const domain = match.slice(at + 1);
    const head = local.slice(0, 1);
    return `${head}***@${domain}`;
  });
}

const isEmailKey = (key: string) => EMAIL_KEYS.has(key.toLowerCase());
const isSensitiveKey = (key: string) => SENSITIVE_KEYS.has(key.toLowerCase());

/**
 * Deep-copies `value`, masking sensitive keys wholesale, email-bearing keys with {@link maskEmail},
 * and any email found inside a free-text string anywhere. Cycles are handled; the input is untouched.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskEmail(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value instanceof Date) return value;
  if (value instanceof Error) return { name: value.name, message: maskEmail(value.message) };

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (isSensitiveKey(key)) out[key] = MASK;
    else if (isEmailKey(key) && typeof v === 'string') out[key] = maskEmail(v);
    else out[key] = redact(v, seen);
  }
  return out;
}
