export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
  constructor(collection: string, from: string, to: string) {
    super(`${collection}: ${from} → ${to} is not an allowed transition`);
  }
}
