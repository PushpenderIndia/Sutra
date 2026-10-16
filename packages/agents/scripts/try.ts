import { parseArgs } from 'node:util';
import { closeDb, DEMO_WORKSPACE_ID } from '@sutra/db';
import { agents, runAgent } from '../src/index.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { session: { type: 'string' }, workspace: { type: 'string' } },
});
const [name = '', ...words] = positionals;
const agent = agents().get(name);
if (!agent || !words.length) {
  console.error(
    `Usage: pnpm agent:try <${[...agents().keys()].join('|')}> "<input>" [--session key]`,
  );
  process.exit(1);
}

try {
  const { output, usage } = await runAgent({
    agent,
    workspaceId: values.workspace ?? DEMO_WORKSPACE_ID,
    sessionKey: values.session ?? `try:${name}`,
    input: words.join(' '),
    stream: true,
    onEvent: (e) => e.partial && process.stdout.write(e.content?.parts?.[0]?.text ?? ''),
  });
  console.log(`\n\n${typeof output === 'string' ? output : JSON.stringify(output, null, 2)}`);
  console.log(
    `\n${usage.tokensIn} in / ${usage.tokensOut} out tokens, $${usage.costUsd.toFixed(6)}`,
  );
} finally {
  await closeDb();
}
