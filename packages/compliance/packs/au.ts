import type { Pack } from '../src/pack.ts';

/** Australia. Product defaults for the prototype, not legal advice: verify with counsel. */
export const AU: Pack = {
  country: 'AU',
  name: 'Australia',
  version: '2026.10',
  sendWindow: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
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
  references: [
    'Spam Act 2003: inferred consent for conspicuously published business addresses',
    'Privacy Act 1988',
  ],
};
