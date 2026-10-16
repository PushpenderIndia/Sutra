/** Runs once at server boot. */
export async function register() {
  // biome-ignore lint/style/noProcessEnv: build-time constant Next inlines to keep Node-only code out of the edge bundle
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
