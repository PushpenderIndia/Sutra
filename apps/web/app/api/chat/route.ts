import { confirmationReply, runCopilot } from '@sutra/agents';
import { chatTurnRequest } from '@sutra/domain';
import { AppError, route } from '@/lib/action';
import { chatToolSpecs } from '@/lib/actions/registry';
import { auth } from '@/lib/auth';
import { copilotSessionKey, copilotState, saveChatMessage } from '@/lib/chat';
import { chatLimit } from '@/lib/rate-limit';

type Frame =
  | { type: 'token'; text: string }
  | { type: 'result'; tool: string; result: unknown }
  | { type: 'confirm'; callId: string; tool: string; args: Record<string, unknown>; hint?: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const encoder = new TextEncoder();
const frame = (f: Frame) => encoder.encode(`data: ${JSON.stringify(f)}\n\n`);

/**
 * The chat copilot: a streaming (SSE) turn, through the same `route()` guard as every other handler
 * (its handler returns a streaming `Response`). A user message runs the copilot and streams its
 * tokens; if the model wants to run a mutation it emits a `confirm` frame instead of acting, and the
 * client posts `{confirm: {callId, confirmed}}` to resume the same session and run (or decline) it.
 * Auth, workspace scope and per-action roles are enforced exactly as elsewhere — the tools ARE the
 * Server Actions.
 */
export const POST = route(
  chatTurnRequest,
  async (ctx, { message, confirm, context }): Promise<Response> => {
    if (!message && !confirm) throw new AppError('INVALID', 'Send a message or a confirmation');
    // Per-workspace rate limit on the copilot (PR 18 hardening).
    if (!chatLimit(ctx.workspaceId))
      throw new AppError('RATE_LIMITED', 'Too many messages — slow down a moment');

    const orgs = await auth.api.listOrganizations({ headers: ctx.headers }).catch(() => []);
    const workspaceName = orgs.find((o) => o.id === ctx.workspaceId)?.name ?? 'your workspace';
    const sessionKey = copilotSessionKey(ctx.user.id);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (f: Frame) => controller.enqueue(frame(f));
        try {
          if (message) await saveChatMessage(ctx, 'user', message, context);
          const { text, confirmation } = await runCopilot({
            workspaceId: ctx.workspaceId,
            userId: ctx.user.id,
            sessionKey,
            input: confirm
              ? confirmationReply(confirm.callId, confirm.confirmed)
              : (message as string),
            specs: chatToolSpecs(),
            state: confirm ? undefined : await copilotState(ctx, workspaceName, context),
            onToken: (t) => send({ type: 'token', text: t }),
            onToolResult: (tool, result) => send({ type: 'result', tool, result }),
          });
          if (confirmation)
            send({
              type: 'confirm',
              callId: confirmation.callId,
              tool: confirmation.tool,
              args: confirmation.args,
              hint: confirmation.hint,
            });
          if (text) await saveChatMessage(ctx, 'assistant', text, context);
          send({ type: 'done', text });
        } catch (error) {
          console.error('[chat]', error);
          send({ type: 'error', error: 'The copilot hit an error. Please try again.' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  },
);
