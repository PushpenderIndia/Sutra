import type { Pack } from '../src/pack.ts';

/** Malaysia. Product defaults for the prototype, not legal advice: verify with counsel. */
export const MY: Pack = {
  country: 'MY',
  name: 'Malaysia',
  version: '2026.10',
  sendWindow: { start: '09:00', end: '17:00', days: [1, 2, 3, 4] },
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
  references: [
    'Personal Data Protection Act 2010',
    'Mon–Thu only: some states keep a Fri–Sat weekend',
  ],
};
