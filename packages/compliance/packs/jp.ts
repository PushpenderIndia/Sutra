import type { Pack } from '../src/pack.ts';

/** Japan. Product defaults for the prototype, not legal advice: verify with counsel. */
export const JP: Pack = {
  country: 'JP',
  name: 'Japan',
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
  references: [
    'Act on Regulation of Transmission of Specified Electronic Mail: opt-in, except addresses published for business',
  ],
};
