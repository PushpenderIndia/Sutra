// A missing or invalid env stops the server at boot with a readable list of every bad key.
try {
  await import('@sutra/config');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

// Wire the observability sinks (structured logs → Cloud Logging, spans → Cloud Trace, metrics) first,
// so job registration and everything after it is traced and logged with correlation ids.
const { installObservability } = await import('./lib/observability');
installObservability();

// Register background-job handlers and select the driver (inline in dev, Cloud Tasks in prod).
const { installJobs } = await import('./lib/jobs');
installJobs();
