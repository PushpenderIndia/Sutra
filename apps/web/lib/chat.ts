import 'server-only';
import type { CopilotState } from '@sutra/agents';
import { Campaigns, ChatMessages, Companies, Contacts } from '@sutra/db';
import type { ChatContext, Id } from '@sutra/domain';
import type { Context } from '@/lib/action';

/** The copilot session is per user, so each person's history is their own. */
export const copilotSessionKey = (userId: string) => `copilot:${userId}`;

/** At most this many selected rows are named in the prompt; the rest are summarised as a count. */
const MAX_NAMED = 10;

/** Human-readable names for the selected rows on the active tab, so "this"/"these" resolve. */
async function describeSelection(ctx: Context, context: ChatContext): Promise<string | undefined> {
  const ids = context.selection.slice(0, MAX_NAMED);
  if (!ids.length) return undefined;
  const extra =
    context.selection.length > ids.length
      ? ` (+${context.selection.length - ids.length} more)`
      : '';
  const name = (label: string, pairs: { id: Id; name: string }[]) =>
    `${label}: ${pairs.map((p) => `${p.name} [id ${p.id}]`).join(', ')}${extra}`;

  if (context.tab === 'prospects') {
    const rows = await Companies.find(
      ctx.workspaceId,
      { _id: { $in: ids } },
      { projection: { name: 1 } },
    );
    return name(
      'Selected companies',
      rows.map((r) => ({ id: r._id, name: r.name })),
    );
  }
  if (context.tab === 'leads') {
    const rows = await Contacts.find(
      ctx.workspaceId,
      { _id: { $in: ids } },
      { projection: { name: 1, email: 1 } },
    );
    return name(
      'Selected leads',
      rows.map((r) => ({ id: r._id, name: r.name ?? r.email })),
    );
  }
  if (context.tab === 'campaigns') {
    const rows = await Campaigns.find(
      ctx.workspaceId,
      { _id: { $in: ids } },
      { projection: { name: 1 } },
    );
    return name(
      'Selected campaigns',
      rows.map((r) => ({ id: r._id, name: r.name })),
    );
  }
  return `Selected ids: ${ids.join(', ')}${extra}`;
}

/** Builds the per-turn copilot context from the signed-in user's workspace and what's on screen. */
export async function copilotState(
  ctx: Context,
  workspaceName: string,
  context: ChatContext,
): Promise<CopilotState> {
  return {
    workspace: workspaceName,
    tab: context.tab,
    selection: await describeSelection(ctx, context),
    activeCampaign: context.campaignId,
  };
}

/** Appends one message to the per-user chat transcript (for reloading the panel). */
export async function saveChatMessage(
  ctx: Context,
  role: 'user' | 'assistant',
  content: string,
  context: ChatContext,
): Promise<void> {
  await ChatMessages.create(ctx.workspaceId, {
    userId: ctx.user.id,
    role,
    content,
    context: { tab: context.tab ?? 'business', selection: context.selection },
  });
}

/** The recent transcript for this user, oldest first, to rehydrate the panel on load. */
export async function loadChatHistory(ctx: Context, limit = 50) {
  const messages = await ChatMessages.find(
    ctx.workspaceId,
    { userId: ctx.user.id },
    { sort: { createdAt: -1 }, limit },
  );
  return messages.reverse().map((m) => ({ id: m._id, role: m.role, content: m.content }));
}
