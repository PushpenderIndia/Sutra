import type { Pack } from '../src/pack.ts';

/** Vietnam. Product defaults for the prototype, not legal advice: verify with counsel. */
export const VN: Pack = {
  country: 'VN',
  name: 'Vietnam',
  version: '2026.10',
  sendWindow: { start: '08:30', end: '17:00', days: [1, 2, 3, 4, 5] },
  email: {
    basis: ['consent', 'existing_customer'],
    b2bOnly: true,
    unsubscribe: 'required',
    listUnsubscribeHeader: 'required',
    senderIdentity: 'required',
    physicalAddress: 'required',
  },
  frequency: { perContactPerWeek: 1, perDomainPerDay: 2 },
  retentionDays: 180,
  references: [
    'Decree 91/2020 on spam: advertising email needs prior consent',
    'Decree 13/2023 on personal data protection',
  ],
};
