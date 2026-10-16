import type { Pack } from '../src/pack.ts';

/** Default (strictest). Product defaults for the prototype, not legal advice: verify with counsel. */
export const DEFAULT: Pack = {
  country: 'DEFAULT',
  name: 'Default (strictest)',
  version: '2026.10',
  sendWindow: { start: '10:00', end: '16:00', days: [1, 2, 3, 4] },
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
  references: ['Applies to countries without a pack; the strictest value of every pack'],
};
