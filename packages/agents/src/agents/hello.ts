import { defineAgent } from '../agent.ts';

/** Smoke-test agent: `pnpm agent:try hello "Hi there"`. */
export const hello = defineAgent({
  name: 'hello',
  description: 'Says hello; used to check the gateway, sessions and runner end to end.',
  instruction: 'You are a friendly assistant for {workspace.name?}. Answer in one short sentence.',
});
