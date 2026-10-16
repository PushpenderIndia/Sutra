import 'server-only';
import { Companies, Contacts } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { groupBy } from '@/lib/utils';

/** One row per company found, best score first, with its contacts. */
export async function loadProspects(workspaceId: Id) {
  const [companies, contacts] = await Promise.all([
    Companies.find(workspaceId, {}, { sort: { score: -1, createdAt: -1 } }),
    Contacts.find(workspaceId, {}, { projection: { companyId: 1, name: 1, title: 1, email: 1 } }),
  ]);
  const byCompany = groupBy(contacts, (c) => c.companyId);
  return companies.map((c) => ({
    id: c._id,
    name: c.name,
    domain: c.domain,
    country: c.country,
    city: c.city,
    industry: c.industry,
    size: c.size,
    sources: [...new Set(c.sources.map((s) => s.source))],
    score: c.score,
    fit: c.fit,
    reasons: c.scoreReasons.map((r) => r.text),
    status: c.status,
    contacts: (byCompany.get(c._id) ?? []).map((p) => ({
      name: p.name,
      title: p.title,
      email: p.email,
    })),
  }));
}
export type ProspectRow = Awaited<ReturnType<typeof loadProspects>>[number];
