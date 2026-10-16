/**
 * Checks whether a domain can receive mail (has MX records). Used only to decide whether a
 * *pattern-guessed* address is worth keeping — there is no SMTP probing (unreliable, spammy, and
 * port 25 is blocked on Cloud Run). The real implementation lives in `@sutra/agents`.
 */
export interface EmailVerifier {
  hasMx(domain: string): Promise<boolean>;
}

/** An {@link EmailVerifier} that accepts a fixed set of domains (defaults to any). */
export function fakeEmailVerifier(domains?: Iterable<string>): EmailVerifier {
  const allow = domains ? new Set([...domains].map((d) => d.toLowerCase())) : undefined;
  return { hasMx: async (domain) => !allow || allow.has(domain.toLowerCase()) };
}
