import { z } from 'zod';
import { route } from '@/lib/action';
import { loadLeads } from '@/lib/data/leads';

/** The Leads tab rows, polled by the tab. */
export const GET = route(z.object({}), ({ workspaceId }) => loadLeads(workspaceId));
