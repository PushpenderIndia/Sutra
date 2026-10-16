import { id } from '@sutra/domain';
import { z } from 'zod';
import { route } from '@/lib/action';
import { loadThread } from '@/lib/data/leads';

/** One lead's email thread, for the lead sheet. */
export const GET = route(z.object({ contactId: id }), ({ workspaceId }, { contactId }) =>
  loadThread(workspaceId, contactId),
);
