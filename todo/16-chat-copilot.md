# PR 16 — Chat copilot

**Branch:** `feat/16-chat-copilot` · **Depends on:** 13, 14 · **Size:** M

## Why
The chat sidebar is how users steer the autonomous system without hunting through screens: ask why, change the ICP, rewrite a step, pause a contact. It acts on the **current tab and selection**.

## Design: every Server Action is a chat tool (DRY)
All mutations already go through `action(inputSchema, handler, opts)` (PR 04). A registry exposes them to the chat agent automatically:

```ts
// apps/web/lib/actions/registry.ts
export const actions = {
  updateIcp:         action(icpPatch, ..., { role: 'admin', chat: { describe: 'Edit the ideal customer profile', confirm: true } }),
  excludeProspects:  action(z.object({ ids: z.array(id).optional(), filter: prospectFilter.optional() }), ..., { chat: { confirm: true } }),
  editVariant:       action(variantEdit, ..., { chat: { confirm: true } }),       // edit → back to pending_approval
  regenerateVariant: action(z.object({ variantId: id, note: z.string() }), ...),
  pauseCampaign:     action(...), resumeCampaign: action(...),
  approveVariant:    action(..., { role: 'admin', chat: { confirm: true } }),
  approveReplyDraft: action(..., { role: 'admin', chat: { confirm: true } }),
  bookMeeting:       action(...),
  optOutContact:     action(...),
  rerunFrom:         action(z.object({ node: pipelineNodeId }), ...),
  // ...
};

// packages/agents/src/chat/tools.ts
export const chatTools = Object.entries(actions)
  .filter(([, a]) => a.chat)
  .map(([name, a]) => new FunctionTool({
    name, description: a.chat.describe, parameters: a.input,                    // same Zod schema
    requireConfirmation: a.chat.confirm,                                       // ADK HITL → confirm card in chat
    execute: (args, ctx) => a.run(ctx.state.authCtx, args),                    // same auth + role checks
  }));
```
- **Read tools:** `searchProspects`, `getCompany`, `explainScore`, `getCampaignStats`, `getVariantInsights`, `getThread`. Read-only, no confirmation.
- **Mutations show a confirm card** in the chat ("Exclude 23 prospects in Thailand? [Confirm] [Cancel]"), using ADK `requireConfirmation`
- **Role checks are identical** to the UI, because the same `action()` runs

## `copilot` agent (`sutra-smart`)
- System prompt: shared fragments + "You operate Sutra for {workspace}". It never claims to have done something without a tool result.
- **Context injection** each turn: current tab, selected IDs (from the PR 05 selection store), active campaign, pipeline status
- Session persisted per user in `chat_messages` (via `MongoSessionService`)
- Streams tokens to the UI (Server-Sent Events from a route handler)
- Inline rich results: prospect mini-tables, variant diffs, stat chips, with links that select rows in the main view

## Example interactions
| User | Copilot does |
|---|---|
| "Why is Kopi Kenangan a strong fit?" | `explainScore` → reasons with sources |
| "We don't sell to restaurants anymore" | `updateIcp` (confirm) → `rerunFrom('prospector')` (confirm) |
| "Make step 2 shorter and more casual" | `regenerateVariant` with a note → the new variant goes to approval |
| "Which variant is winning in Japan?" | `getCampaignStats({locale: 'ja'})` |
| "Pause everyone at acme.com" | `pauseContacts({domain})` (confirm) |
| "Book Rahul for Thursday 3pm his time" | `checkAvailability` → `bookMeeting` (confirm) |

## Tasks
- [ ] Action registry + `chat` metadata on existing actions
- [ ] `chatTools` generator + read tools
- [ ] `copilot` agent + context injection + session persistence
- [ ] Chat panel UI: streaming, confirm cards, rich results, selection links
- [ ] Prompt-injection tests (malicious prospect data must not trigger tools)

## Acceptance criteria
- Every mutation from chat requires a confirm click and passes the same role checks as the UI (tested)
- "Edit the ICP" from chat produces the same result as editing in the Business tab
- The copilot answers questions about the selected rows without the user naming them
