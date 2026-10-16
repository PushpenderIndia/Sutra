import type { Pack } from '../src/pack.ts';

/** Singapore. Product defaults for the prototype, not legal advice: verify with counsel. */
export const SG: Pack = {
  country: 'SG',
  name: 'Singapore',
  version: '2026.10',
  sendWindow: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  email: {
    basis: ['consent', 'legitimate_interest', 'existing_customer'],
    b2bOnly: true,
    unsubscribe: 'required',
    listUnsubscribeHeader: 'required',
    senderIdentity: 'required',
    physicalAddress: 'required',
  },
  frequency: { perContactPerWeek: 2, perDomainPerDay: 3 },
  retentionDays: 365,
  references: ['Spam Control Act 2007', 'Personal Data Protection Act 2012'],
};
