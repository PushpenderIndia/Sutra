import type { Pack } from '../src/pack.ts';
import { AU } from './au.ts';
import { DEFAULT } from './default.ts';
import { ID } from './id.ts';
import { IN } from './in.ts';
import { JP } from './jp.ts';
import { MY } from './my.ts';
import { PH } from './ph.ts';
import { SG } from './sg.ts';
import { TH } from './th.ts';
import { VN } from './vn.ts';

export { AU, DEFAULT, ID, IN, JP, MY, PH, SG, TH, VN };

/** Every country pack, keyed by ISO country code. Unknown countries get `DEFAULT`. */
export const PACKS: Readonly<Record<string, Pack>> = Object.fromEntries(
  [SG, IN, ID, PH, MY, TH, VN, JP, AU].map((p) => [p.country, p]),
);
