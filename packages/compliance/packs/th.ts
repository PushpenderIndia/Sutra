import type { Pack } from '../src/pack.ts';

/** Thailand. Product defaults for the prototype, not legal advice: verify with counsel. */
export const TH: Pack = {
  country: 'TH',
  name: 'Thailand',
  version: '2026.10',
  sendWindow: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  email: {
    basis: ['consent', 'legitimate_interest', 'existing_customer'],
    b2bOnly: true,
    unsubscribe: 'required',
    listUnsubscribeHeader: 'required',
    senderIdentity: 'required',
    physicalAddress: 'recommended',
  },
  frequency: { perContactPerWeek: 2, perDomainPerDay: 3 },
  retentionDays: 365,
  references: ['Personal Data Protection Act 2019'],
};
