import { AsyncLocalStorage } from 'node:async_hooks';
import {
  BasePlugin,
  type BaseTool,
  type Context,
  type Event,
  type InvocationContext,
  type LlmResponse,
} from '@google/adk';
import { newId, PipelineNodes } from '@sutra/db';
import type { Id } from '@sutra/domain';

/** The pipeline node whose `run` is executing. Set by the engine, read by the recorder. */
export type NodeScope = { workspaceId: Id; runId: Id; nodeId: string };
export const nodeScope = new AsyncLocalStorage<NodeScope>();

/** `pipeline_nodes` id of an agent running inside a node, e.g. `profiler/crawler`. */
export const subNodeId = (nodeId: string, agent: string) => `${nodeId}/${agent}`;

const nodes = () => PipelineNodes.col();

/**
 * Records sub-agents, tool calls, tokens and cost of agents run inside a pipeline node into
 * `pipeline_nodes`, so agents need no graph code. Outside a pipeline node it does nothing.
 */
export class PipelineRecorder extends BasePlugin {
  constructor() {
    super('pipeline_recorder');
  }

  private key(scope: NodeScope, agent: string) {
    return {
      workspaceId: scope.workspaceId,
      runId: scope.runId,
      nodeId: subNodeId(scope.nodeId, agent),
    };
  }

  /** Agents seen in this run (one runner, so one plugin instance, per `runAgent`). */
  private started = new Set<string>();

  private async start(agent: string) {
    const scope = nodeScope.getStore();
    if (!scope || this.started.has(agent)) return;
    this.started.add(agent);
    const now = new Date();
    await nodes().updateOne(
      this.key(scope, agent),
      {
        $set: { status: 'running', startedAt: now, updatedAt: now },
        $unset: { endedAt: '' },
        $setOnInsert: {
          _id: newId(),
          parentId: scope.nodeId,
          agent,
          tokens: 0,
          costUsd: 0,
          toolCalls: [],
          createdAt: now,
        },
      },
      { upsert: true },
    );
  }

  // ADK-JS 2 fires no agent-level plugin callbacks for a runner's root agent, so a run's start
  // and end mark the root, and each event's author reveals sub-agents (transfers, agent tools).
  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }) {
    if (invocationContext.agent) await this.start(invocationContext.agent.name);
    return undefined;
  }

  override async onEventCallback({ event }: { event: Event }) {
    if (event.author && event.author !== 'user') await this.start(event.author);
    return undefined;
  }

  override async afterRunCallback() {
    const scope = nodeScope.getStore();
    if (scope && this.started.size)
      await nodes().updateMany(
        {
          workspaceId: scope.workspaceId,
          runId: scope.runId,
          nodeId: { $in: [...this.started].map((a) => subNodeId(scope.nodeId, a)) },
        },
        { $set: { status: 'done', endedAt: new Date(), updatedAt: new Date() } },
      );
  }

  override async beforeToolCallback({
    tool,
    toolContext,
  }: {
    tool: BaseTool;
    toolContext: Context;
  }) {
    const scope = nodeScope.getStore();
    if (scope)
      await nodes().updateOne(this.key(scope, toolContext.agentName), {
        $push: { toolCalls: { name: tool.name, at: new Date() } },
        $set: { updatedAt: new Date() },
      });
    return undefined;
  }

  override async afterModelCallback({
    callbackContext,
    llmResponse,
  }: {
    callbackContext: Context;
    llmResponse: LlmResponse;
  }) {
    const scope = nodeScope.getStore();
    const tokens = llmResponse.usageMetadata?.totalTokenCount ?? 0;
    const costUsd = Number(llmResponse.customMetadata?.costUsd ?? 0);
    if (!scope || llmResponse.partial || !(tokens || costUsd)) return undefined;
    const { nodeId, ...run } = scope;
    await nodes().updateMany(
      { ...run, nodeId: { $in: [nodeId, subNodeId(nodeId, callbackContext.agentName)] } },
      { $inc: { tokens, costUsd }, $set: { updatedAt: new Date() } },
    );
    return undefined;
  }
}

/**
 * Reports live progress of the running pipeline node (or fan-out child) for the agent graph:
 * `reportProgress(148)` for "148 found", `reportProgress(87, 148)` for a progress bar.
 * Outside a pipeline node it does nothing.
 */
export async function reportProgress(done: number, total?: number) {
  const scope = nodeScope.getStore();
  if (!scope) return;
  await nodes().updateOne(scope, {
    $set: { progress: total === undefined ? { done } : { done, total }, updatedAt: new Date() },
  });
}
