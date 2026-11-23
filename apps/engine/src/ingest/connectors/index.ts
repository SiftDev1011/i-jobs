import { Connector } from '../types';
import { aggregatorConnectors } from './aggregators';
import { atsConnectors } from './ats';
import { boardConnectors } from './boards';
import { socialConnectors } from './social';

/** Jobs community owners paste. The AI reads them; the owner confirms before they go live. */
const communityPaste: Connector = {
  key: 'community_paste',
  internal: true,
  async fetch() {
    return { items: [], complete: false };
  },
  normalise(p: { text: string }) {
    return { title: '', company: '', description: String(p.text ?? ''), sourceUrl: null, location: {}, needsAi: true };
  },
};

/** Every external source we can fetch, by source key. Internal sources (pastes, employer posts) come in through the API. */
export const CONNECTORS: ReadonlyMap<string, Connector> = new Map(
  [...atsConnectors, ...boardConnectors, ...aggregatorConnectors, ...socialConnectors, communityPaste].map((c) => [c.key, c]),
);

export function connectorFor(key: string): Connector | undefined {
  return CONNECTORS.get(key);
}
