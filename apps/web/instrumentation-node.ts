// A missing or invalid env stops the server at boot with a readable list of every bad key.
try {
  await import('@sutra/config');
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
