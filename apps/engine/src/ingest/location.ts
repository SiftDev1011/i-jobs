import { CA_PROVINCES, COUNTRIES, PLACE_NAMES, REGION_WORDS, US_STATES } from './places';

export type LocationScope = 'worldwide' | 'unspecified' | 'restricted';

export interface LocationTags {
  isRemote: boolean;
  scope: LocationScope;
  countries: string[];
  regions: string[];
  tzMin: number | null;
  tzMax: number | null;
}

export interface LocationHints {
  /** Free-text locations from the source ("Remote - EMEA", "Lagos, Nigeria"). */
  texts?: (string | null | undefined)[];
  /** What the source says outright, when it says it. */
  remote?: boolean | null;
  workplace?: 'remote' | 'hybrid' | 'onsite' | null;
  /** ISO codes or country names the source lists. */
  countries?: (string | null | undefined)[];
  /** UTC offsets the source lists (Himalayas). */
  tzOffsets?: number[];
  /** True when the whole source is remote-only (remote boards). */
  remoteSource?: boolean;
}

const REMOTE_RE = /\b(remote|remotely|anywhere|worldwide|work from home|wfh|telecommut\w*|distributed|home[- ]based|location[- ]independent|virtual)\b/;
const NOT_REMOTE_RE = /\b(hybrid|on-?site|in[- ]office|office[- ]based|in person)\b/;
const FULLY_REMOTE_RE = /\b(fully remote|100% remote|remote[- ]first|remote only)\b/;
const WORLDWIDE_RE = /\b(worldwide|world ?wide|global(ly)?|anywhere(?! in\b)|anywhere in the world|all countries|any country|any location|location[- ]independent|no location restrictions?)\b/;

const TZ_ABBR: Record<string, number> = {
  UTC: 0, GMT: 0, WET: 0, BST: 1, CET: 1, WAT: 1, CEST: 2, EET: 2, CAT: 2, SAST: 2, EEST: 3, EAT: 3, MSK: 3,
  GST: 4, PKT: 5, IST: 5, ICT: 7, WIB: 7, SGT: 8, PHT: 8, AWST: 8, JST: 9, KST: 9, AEST: 10, AEDT: 11, NZST: 12,
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, HST: -10, BRT: -3, ART: -3,
};
const TZ_WORDS: [RegExp, number][] = [
  [/\beastern time\b/, -5], [/\bcentral time\b/, -6], [/\bmountain time\b/, -7], [/\bpacific time\b/, -8],
  [/\bcentral european time\b/, 1], [/\beastern european time\b/, 2], [/\bwest africa time\b/, 1],
];

/** Turns whatever a source says about place into scope, countries, regions and time zones. */
export function tagLocation(h: LocationHints): LocationTags {
  const original = (h.texts ?? []).filter(Boolean).join(' ; ');
  let text = ` ${original.toLowerCase().replace(/[()[\]/|•·–—_]+/g, ' , ')} `;

  const countries = new Set<string>();
  const regions = new Set<string>();

  for (const c of h.countries ?? []) {
    const code = countryCode(c);
    if (code) countries.add(code);
  }

  // Remote-ness first, before place words are blanked out.
  let isRemote: boolean;
  if (h.workplace === 'hybrid' || h.workplace === 'onsite') isRemote = false;
  else if (h.workplace === 'remote' || h.remote === true) isRemote = true;
  else if (h.remote === false) isRemote = false;
  else if (FULLY_REMOTE_RE.test(text)) isRemote = true;
  else if (NOT_REMOTE_RE.test(text)) isRemote = false;
  else if (REMOTE_RE.test(text)) isRemote = true;
  else isRemote = !!h.remoteSource;

  const worldwide = WORLDWIDE_RE.test(text);

  // Upper-case short forms only count in their original case ("US", not "us").
  const upper = ` ${original} `;
  if (/[\s,(/-](US|USA|U\.S\.A?\.?)(?=[\s,)/;.-]|$)/.test(upper)) countries.add('US');
  if (/[\s,(/-](UK|U\.K\.)(?=[\s,)/;.-]|$)/.test(upper)) countries.add('GB');
  if (/[\s,(/-]UAE(?=[\s,)/;.-]|$)/.test(upper)) countries.add('AE');
  if (/[\s,(/-]DRC(?=[\s,)/;.-]|$)/.test(upper)) countries.add('CD');
  if (/[\s,(/-]EU(?=[\s,)/;.-]|$)/.test(upper)) regions.add('europe');
  // "Austin, TX" / "Toronto, ON"
  for (const m of upper.matchAll(/,\s*([A-Z]{2})(?=[\s,);]|$)/g)) {
    if (US_STATES[m[1]]) countries.add('US');
    else if (CA_PROVINCES.includes(m[1])) countries.add('CA');
    else if (COUNTRIES.has(m[1])) countries.add(m[1]);
  }

  for (const [re, region] of REGION_WORDS) {
    if (re.test(text)) {
      regions.add(region);
      text = text.replace(new RegExp(re.source, 'g'), ' ');
    }
  }

  // Georgia the US state only when other US signs are there.
  const usHint = countries.has('US') || /\b(atlanta|savannah)\b/.test(text);
  for (const [name, code] of PLACE_NAMES) {
    if (!text.includes(name)) continue;
    const re = new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, 'u');
    if (!re.test(text)) continue;
    countries.add(name === 'georgia' && usHint ? 'US' : code);
    text = text.replace(new RegExp(`(^|[^\\p{L}])${escapeRe(name)}(?=$|[^\\p{L}])`, 'gu'), '$1 ');
  }

  const tz = parseTimezones(original, h.tzOffsets);

  let scope: LocationScope;
  if (worldwide && isRemote) scope = 'worldwide';
  else if (countries.size || regions.size) scope = 'restricted';
  else scope = 'unspecified';

  return {
    isRemote,
    scope,
    countries: [...countries].sort(),
    regions: [...regions].sort(),
    tzMin: tz?.min ?? null,
    tzMax: tz?.max ?? null,
  };
}

export function countryCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (/^[A-Za-z]{2}$/.test(s)) {
    const up = s.toUpperCase() === 'UK' ? 'GB' : s.toUpperCase();
    return COUNTRIES.has(up) ? up : null;
  }
  if (/^[A-Za-z]{3}$/.test(s)) return ISO3[s.toUpperCase()] ?? null;
  const lower = s.toLowerCase();
  if (['usa', 'us', 'u.s.', 'u.s.a.'].includes(lower)) return 'US';
  if (['uk', 'u.k.'].includes(lower)) return 'GB';
  const hit = PLACE_NAMES.find(([name]) => name === lower);
  return hit ? hit[1] : null;
}

function parseTimezones(text: string, given?: number[]): { min: number; max: number } | null {
  const found: number[] = [...(given ?? [])].filter((n) => Number.isFinite(n));
  for (const m of text.matchAll(/\b(?:UTC|GMT)\s*([+\-−–])\s*(\d{1,2})(?::?(\d{2}))?/gi)) {
    const sign = m[1] === '+' ? 1 : -1;
    found.push(sign * Number(m[2]));
  }
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) {
    if (m[1] in TZ_ABBR && !/^(UTC|GMT)$/.test(m[1])) found.push(TZ_ABBR[m[1]]);
  }
  if (/\b(UTC|GMT)\b(?!\s*[+\-−–]\s*\d)/.test(text)) found.push(0);
  const lower = text.toLowerCase();
  for (const [re, off] of TZ_WORDS) if (re.test(lower)) found.push(off);

  const valid = found.filter((n) => n >= -12 && n <= 14).map((n) => Math.round(n));
  if (!valid.length) return null;
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  // "GMT+1 ± 3 hours", "+/- 2 hours"
  const spread = text.match(/(?:±|\+\/-|\+-)\s*(\d{1,2})\s*(?:h|hours?)/i);
  if (spread) {
    min = Math.max(-12, min - Number(spread[1]));
    max = Math.min(14, max + Number(spread[1]));
  }
  return { min, max };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ISO3: Record<string, string> = {
  NGA: 'NG', GHA: 'GH', KEN: 'KE', ZAF: 'ZA', ETH: 'ET', UGA: 'UG', RWA: 'RW', SEN: 'SN', CMR: 'CM', TZA: 'TZ',
  EGY: 'EG', MAR: 'MA', TUN: 'TN', DZA: 'DZ', CIV: 'CI', COD: 'CD', COG: 'CG', SDN: 'SD', SSD: 'SS', SOM: 'SO',
  ZMB: 'ZM', ZWE: 'ZW', MOZ: 'MZ', MWI: 'MW', MLI: 'ML', NER: 'NE', BFA: 'BF', TCD: 'TD', CAF: 'CF', LBR: 'LR',
  SLE: 'SL', GIN: 'GN', BEN: 'BJ', TGO: 'TG', AGO: 'AO', NAM: 'NA', BWA: 'BW', MDG: 'MG', BDI: 'BI', ERI: 'ER',
  DJI: 'DJ', LSO: 'LS', SWZ: 'SZ', GAB: 'GA', GNQ: 'GQ', GMB: 'GM', GNB: 'GW', MRT: 'MR', LBY: 'LY', CPV: 'CV',
  USA: 'US', GBR: 'GB', CAN: 'CA', DEU: 'DE', FRA: 'FR', NLD: 'NL', ESP: 'ES', ITA: 'IT', PRT: 'PT', IRL: 'IE',
  IND: 'IN', PAK: 'PK', BGD: 'BD', PHL: 'PH', IDN: 'ID', AFG: 'AF', IRQ: 'IQ', SYR: 'SY', YEM: 'YE', LBN: 'LB',
  JOR: 'JO', PSE: 'PS', UKR: 'UA', HTI: 'HT', COL: 'CO', VEN: 'VE', BRA: 'BR', MEX: 'MX', ARE: 'AE', SAU: 'SA',
  MMR: 'MM', NPL: 'NP', LKA: 'LK', AUS: 'AU', NZL: 'NZ', CHN: 'CN', JPN: 'JP', KOR: 'KR', TUR: 'TR', POL: 'PL',
};
