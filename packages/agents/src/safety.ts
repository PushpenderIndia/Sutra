import { BasePlugin, type BaseTool, type Context, type LlmRequest } from '@google/adk';
import { audit } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { UNTRUSTED_BLOCK } from './prompts/base.ts';

/** Phrases that read as instructions to the model rather than content. */
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|prompts?|rules?|guidelines?|directions?)\b/i,
  /\b(you are now|act as|pretend (to be|you are)|new instructions?|system prompt|developer mode|jailbreak)\b/i,
  /^\s*(system|assistant|developer)\s*:/i,
  /<\s*\/?\s*(system|instructions?|prompt)\s*>/i,
  /\b(call|invoke|run|execute|use)\b.{0,30}\b(tool|function)\b/i,
];
export const REMOVED = '[removed: instruction-like text in untrusted content]';

/** Removes instruction-like lines inside `<untrusted>` blocks. Returns the text and a hit count. */
export function stripInjections(text: string): { text: string; flagged: number } {
  let flagged = 0;
  const out = text.replace(
    UNTRUSTED_BLOCK,
    (_, open: string, inner: string, close: string) =>
      open +
      inner
        .split('\n')
        .map((line) => {
          if (!INJECTION.some((re) => re.test(line))) return line;
          flagged++;
          return REMOVED;
        })
        .join('\n') +
      close,
  );
  return { text: out, flagged };
}

const sideEffecting = new WeakSet<BaseTool>();
/** Marks a tool as side-effecting (sends, writes, spends): it then passes the compliance hook. */
export function sideEffect<T extends BaseTool>(tool: T): T {
  sideEffecting.add(tool);
  return tool;
}
export const isSideEffect = (tool: BaseTool) => sideEffecting.has(tool);

export type ComplianceVerdict = { allowed: true } | { allowed: false; reason: string };
export type ComplianceCheck = (call: {
  workspaceId: Id;
  agent: string;
  tool: string;
  args: Record<string, unknown>;
}) => Promise<ComplianceVerdict>;

let complianceCheck: ComplianceCheck = async () => ({ allowed: true });
/** Installs the policy engine (PR 10 `compliance.check`) that side-effecting tools run through. */
export const setComplianceCheck = (check: ComplianceCheck) => {
  complianceCheck = check;
};

const blocked = (reason: string) => ({ error: `Tool call blocked: ${reason}`, blocked: true });

/**
 * Strips and flags instructions found inside untrusted blocks before every model call, and
 * blocks side-effecting tools for the rest of an invocation in which an injection was flagged.
 */
export class InjectionGuard extends BasePlugin {
  private flagged = new Set<string>();

  private readonly workspaceId: Id;

  constructor(workspaceId: Id) {
    super('injection_guard');
    this.workspaceId = workspaceId;
  }

  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: Context;
    llmRequest: LlmRequest;
  }) {
    let hits = 0;
    const clean = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const { text, flagged } = stripInjections(value);
        hits += flagged;
        return text;
      }
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
      return value;
    };
    for (const content of llmRequest.contents)
      for (const part of content.parts ?? []) {
        if (part.text) part.text = clean(part.text) as string;
        if (part.functionResponse?.response)
          part.functionResponse.response = clean(part.functionResponse.response) as Record<
            string,
            unknown
          >;
      }
    if (hits && !this.flagged.has(callbackContext.invocationId)) {
      this.flagged.add(callbackContext.invocationId);
      await audit(
        this.workspaceId,
        { kind: 'agent', id: callbackContext.agentName },
        'injection.flagged',
        { entity: 'adk_session', entityId: callbackContext.sessionId, data: { hits } },
      );
    }
    return undefined;
  }

  override async beforeToolCallback({
    tool,
    toolContext,
  }: {
    tool: BaseTool;
    toolContext: Context;
  }) {
    if (isSideEffect(tool) && this.flagged.has(toolContext.invocationId))
      return blocked('this turn contains untrusted content that tried to instruct the agent');
    return undefined;
  }
}

/** Every side-effecting tool call goes through the compliance hook and is audited. */
export class ToolGuard extends BasePlugin {
  private readonly workspaceId: Id;

  constructor(workspaceId: Id) {
    super('tool_guard');
    this.workspaceId = workspaceId;
  }

  private record(ctx: Context, tool: BaseTool, action: string, data: Record<string, unknown>) {
    return audit(this.workspaceId, { kind: 'agent', id: ctx.agentName }, action, {
      entity: 'tool',
      entityId: tool.name,
      data,
    });
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: Context;
  }) {
    if (!isSideEffect(tool)) return undefined;
    const verdict = await complianceCheck({
      workspaceId: this.workspaceId,
      agent: toolContext.agentName,
      tool: tool.name,
      args: toolArgs,
    });
    if (verdict.allowed) return undefined;
    await this.record(toolContext, tool, 'tool.blocked', {
      args: toolArgs,
      reason: verdict.reason,
    });
    return blocked(verdict.reason);
  }

  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: Context;
    result: Record<string, unknown>;
  }) {
    // ADK runs after-tool callbacks for short-circuited calls too.
    if (isSideEffect(tool) && !result.blocked)
      await this.record(toolContext, tool, 'tool.called', { args: toolArgs });
    return undefined;
  }
}
