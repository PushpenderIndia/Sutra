import type { Pack } from '../src/pack.ts';

/** India. Product defaults for the prototype, not legal advice: verify with counsel. */
export const IN: Pack = {
  country: 'IN',
  name: 'India',
  version: '2026.10',
  sendWindow: { start: '10:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  email: {
    basis: ['consent', 'legitimate_interest', 'existing_customer'],
    b2bOnly: true,
    unsubscribe: 'required',
    listUnsubscribeHeader: 'required',
    senderIdentity: 'required',
    physicalAddress: 'recommended',
  },
  frequency: { perContactPerWeek: 2, perDomainPerDay: 3 },
  retentionDays: 180,
  references: ['Digital Personal Data Protection Act 2023', 'Information Technology Act 2000'],
};
