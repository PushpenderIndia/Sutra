'use server';
import { audit, Companies, Contacts } from '@sutra/db';
import { canTransition, contactTransitions, country, id } from '@sutra/domain';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';

/**
 * Excludes prospect companies from the campaign — by id (e.g. the selected rows) or by country
 * ("remove leads from Thailand"). The companies move to `excluded`, and any of their contacts still
 * `new` (not yet contacted) are excluded too; already-contacted contacts are left untouched. Exposed
 * to the chat copilot, where it requires confirmation first.
 */
export const excludeProspects = action(
  z.object({
    companyIds: z.array(id).max(200).optional().describe('Specific company ids to exclude'),
    country: country.optional().describe('Exclude every company in this ISO-3166 alpha-2 country'),
  }),
  async ({ workspaceId, user }, { companyIds, country: cc }) => {
    if (!companyIds?.length && !cc)
      throw new AppError('INVALID', 'Say which prospects to exclude (ids or a country)');
    const filter: Record<string, unknown> = {};
    if (companyIds?.length) filter._id = { $in: companyIds };
    if (cc) filter.country = cc;
    const companies = await Companies.find(workspaceId, filter, { projection: { _id: 1 } });
    if (!companies.length) return { excluded: 0, contactsExcluded: 0 };
    const ids = companies.map((c) => c._id);

    await Companies.col().updateMany(
      { workspaceId, _id: { $in: ids } },
      { $set: { status: 'excluded', updatedAt: new Date() } },
    );
    const contacts = await Contacts.find(
      workspaceId,
      { companyId: { $in: ids }, status: 'new' },
      { projection: { status: 1 } },
    );
    let contactsExcluded = 0;
    for (const c of contacts) {
      if (!canTransition(contactTransitions, c.status, 'excluded')) continue;
      await Contacts.transition(workspaceId, c._id, c.status, 'excluded', contactTransitions);
      contactsExcluded++;
    }
    await audit(workspaceId, { kind: 'user', id: user.id }, 'prospects.exclude', {
      entity: 'companies',
      data: { count: ids.length, byCountry: cc, contactsExcluded },
    });
    return { excluded: ids.length, contactsExcluded };
  },
);
