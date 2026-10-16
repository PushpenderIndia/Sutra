import type { Actor, Id } from '@sutra/domain';
import { AuditEvents } from './collections.ts';

/** Records a side effect. Call it after every mutation an agent, user or job performs. */
export const audit = (
  workspaceId: Id,
  actor: Actor,
  action: string,
  target: { entity: string; entityId?: string; data?: Record<string, unknown> },
) => AuditEvents.create(workspaceId, { actor, action, ...target, at: new Date() });
