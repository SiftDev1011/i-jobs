/** Turns each source's own words into our fields: employment type, pay, category, duplicate key. */

export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'freelance' | 'internship' | 'graduate' | 'temporary';
export type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year' | 'project';

export function employmentType(...values: (string | string[] | null | undefined)[]): EmploymentType | null {
  const s = values
    .flat()
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_-]/g, ' ');
  if (!s.trim()) return null;
  if (/\b(intern|internship|interns|siwes|industrial training|apprentice(ship)?|trainee(ship)?|placement)\b/.test(s)) return 'internship';
  if (/\b(graduate|new grad|entry level graduate|nysc)\b/.test(s)) return 'graduate';
  if (/\b(freelance|freelancer|gig)\b/.test(s)) return 'freelance';
  if (/\b(contract|contractor|fixed term|fixedterm|consultan(t|cy))\b/.test(s)) return 'contract';
  if (/\b(temporary|temp|seasonal)\b/.test(s)) return 'temporary';
  if (/\b(part ?time|parttime)\b/.test(s)) return 'part_time';
  if (/\b(full ?time|fulltime|permanent|regular|employee)\b/.test(s)) return 'full_time';
  return null;
}

export function seniority(title: string, given?: string | string[] | null): string | null {
  const s = [title, ...[given ?? []].flat()].join(' ').toLowerCase();
  if (/\b(intern|internship|trainee|apprentice)\b/.test(s)) return 'intern';
  if (/\b(entry[- ]level|junior|jr\.?|graduate|associate)\b/.test(s)) return 'junior';
  if (/\b(principal|staff|distinguished)\b/.test(s)) return 'principal';
  if (/\b(head of|director|vp|vice president|chief|cto|ceo|cfo|coo)\b/.test(s)) return 'director';
  if (/\b(lead|manager)\b/.test(s)) return 'lead';
  if (/\b(senior|sr\.?|experienced)\b/.test(s)) return 'senior';
  if (/\b(mid[- ]level|intermediate)\b/.test(s)) return 'mid';
  return null;
}

// ---------------------------------------------------------------- pay

export interface Pay {
  minMinor: number | null;
  maxMinor: number | null;
  currency: string | null;
  period: PayPeriod | null;
}
const EMPTY_PAY: Pay = { minMinor: null, maxMinor: null, currency: null, period: null };

/** Minor units per major unit. Most currencies use 100; a few have none. */
const MINOR: Record<string, number> = { JPY: 1, KRW: 1, VND: 1, CLP: 1, UGX: 1, RWF: 1, XOF: 1, XAF: 1 };

export function payPeriod(v: string | null | undefined): PayPeriod | null {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (/^(h|hr|hour|hourly|per hour|1 hour)$|\bhour/.test(s)) return 'hour';
  if (/^(d|day|daily)$|\bday/.test(s)) return 'day';
  if (/^(w|wk|week|weekly)$|\bweek/.test(s)) return 'week';
  if (/^(m|mo|month|monthly|pm)$|\bmonth/.test(s)) return 'month';
  if (/^(y|yr|year|yearly|annual|annually|pa|p\.a\.)$|\b(year|annum|annual)/.test(s)) return 'year';
  if (/project|fixed/.test(s)) return 'project';
  return null;
}

/** From numbers the source gives. Values are in major units (dollars, naira). */
export function payFromNumbers(min: unknown, max: unknown, currency: unknown, period: unknown): Pay {
  const cur = currencyCode(currency);
  const lo = num(min);
  const hi = num(max);
  if (lo === null && hi === null) return EMPTY_PAY;
  const per = payPeriod(typeof period === 'string' ? period : null) ?? guessPeriod(hi ?? lo!, cur);
  return finishPay(lo, hi, cur, per);
}

const SYMBOLS: [RegExp, string][] = [
  [/₦|\bngn\b|\bnaira\b/i, 'NGN'],
  [/€|\beur\b|\beuros?\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/₹|\binr\b|\brs\.?\s/i, 'INR'],
  [/\bksh\.?|\bkes\b/i, 'KES'],
  [/gh₵|\bghs\b|\bcedis?\b/i, 'GHS'],
  [/\bzar\b/i, 'ZAR'],
  [/\bcad\b|c\$/i, 'CAD'],
  [/\baud\b|a\$/i, 'AUD'],
  [/\bbrl\b|r\$/i, 'BRL'],
  [/\busd\b|us\$|\$/i, 'USD'],
];

/** From a sentence: "$50k - $70k a year", "₦300,000/month", "USD 25-35 per hour". */
export function payFromText(text: string | null | undefined, fallbackCurrency?: string | null): Pay {
  if (!text) return EMPTY_PAY;
  const s = String(text);
  let cur: string | null = null;
  for (const [re, code] of SYMBOLS) {
    if (re.test(s)) {
      cur = code;
      break;
    }
  }
  cur ??= currencyCode(fallbackCurrency);
  const nums = [...s.matchAll(/(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/gi)]
    .map((m) => {
      const n = Number(m[1].replace(/[,\s]/g, ''));
      const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
      return n * mult;
    })
    .filter((n) => n > 0 && n < 1e10);
  if (!nums.length || !cur) return EMPTY_PAY;
  const lo = Math.min(...nums.slice(0, 2));
  const hi = Math.max(...nums.slice(0, 2));
  const per = payPeriod((s.match(/(per|a|\/|an)\s*(hour|hr|h|day|week|wk|month|mo|year|yr|annum)\b/i) ?? [])[2])
    ?? payPeriod((s.match(/\b(hourly|daily|weekly|monthly|yearly|annually|annual)\b/i) ?? [])[1])
    ?? guessPeriod(hi, cur);
  return finishPay(lo, hi === lo ? null : hi, cur, per);
}

function finishPay(lo: number | null, hi: number | null, cur: string | null, per: PayPeriod | null): Pay {
  if (!cur) return EMPTY_PAY;
  const unit = MINOR[cur] ?? 100;
  let a = lo === null ? null : Math.round(lo * unit);
  let b = hi === null ? null : Math.round(hi * unit);
  if (a !== null && b !== null && a > b) [a, b] = [b, a];
  if ((a ?? 0) <= 0 && (b ?? 0) <= 0) return EMPTY_PAY;
  return { minMinor: a && a > 0 ? a : null, maxMinor: b && b > 0 ? b : null, currency: cur, period: per };
}

function guessPeriod(amount: number, cur: string | null): PayPeriod | null {
  if (!cur) return null;
  if (['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(cur)) {
    if (amount >= 15_000) return 'year';
    if (amount >= 1_000) return 'month';
    if (amount <= 200) return 'hour';
  }
  if (cur === 'NGN') return amount >= 5_000_000 ? 'year' : amount >= 30_000 ? 'month' : null;
  return null;
}

export function currencyCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  if (s === '$') return 'USD';
  if (s === '€') return 'EUR';
  if (s === '£') return 'GBP';
  if (s === '₦') return 'NGN';
  return null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------- category

export const CATEGORIES = [
  'engineering', 'data', 'design', 'product', 'marketing', 'sales', 'customer-support', 'writing',
  'operations', 'finance', 'hr', 'education', 'health', 'legal', 'ngo', 'internships', 'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_RULES: [Category, RegExp][] = [
  ['data', /\b(data (scientist|analyst|engineer|entry)?|analytics|machine learning|ml engineer|ai engineer|bi (analyst|developer)|business intelligence|statistic\w*)\b/],
  ['engineering', /\b(engineer\w*|developer|devops|sre|programmer|software|front[- ]?end|back[- ]?end|full[- ]?stack|mobile|ios|android|qa|tester|test automation|security|cloud|architect|web3|blockchain|php|python|java(script)?|react|node(\.js)?|golang|rust|ruby|\.net|wordpress)\b/],
  ['design', /\b(design\w*|ux|ui|graphic|illustrat\w*|creative|video editor|motion|animator|photograph\w*)\b/],
  ['product', /\b(product (manager|owner|lead|analyst)|program manager|project manager|scrum master|delivery manager)\b/],
  ['customer-support', /\b(customer (support|service|success|experience|care)|support (agent|specialist|representative|associate)|help ?desk|call cent(er|re)|client (support|success)|technical support)\b/],
  ['sales', /\b(sales|account executive|business development|bdr|sdr|account manager|closer|lead generation|telemarket\w*)\b/],
  ['marketing', /\b(marketing|marketer|seo|sem|ppc|social media|growth|brand|community manager|influencer|media buyer|email marketing)\b/],
  ['writing', /\b(writer|copywrit\w*|editor|content|journalist|translator|translation|transcri\w*|proofread\w*|technical writ\w*)\b/],
  ['finance', /\b(accountant|accounting|finance|financial|bookkeep\w*|audit\w*|tax|payroll|controller|treasury|credit analyst)\b/],
  ['hr', /\b(recruit\w*|talent acquisition|human resources|hr|people (ops|operations|partner)|hrbp)\b/],
  ['legal', /\b(legal|lawyer|counsel|paralegal|compliance|attorney|solicitor)\b/],
  ['education', /\b(teacher|tutor|instructor|lecturer|education\w*|curriculum|teaching|coach)\b/],
  ['health', /\b(nurse|nursing|doctor|physician|medical|health\w*|clinical|pharm\w*|therap\w*|dental|caregiver)\b/],
  ['operations', /\b(operations|virtual assistant|administrative|admin assistant|executive assistant|office manager|logistics|supply chain|procurement|coordinator|dispatcher)\b/],
];

/** Category from the title first, then the source's own labels, then the description's opening. */
export function categorise(input: { title: string; employment: EmploymentType | null; sourceLabels?: (string | null | undefined)[]; description?: string; ngo?: boolean }): Category {
  if (input.employment === 'internship' || /\b(intern|internship|siwes|nysc|graduate trainee)\b/i.test(input.title)) return 'internships';
  const title = input.title.toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  const labels = (input.sourceLabels ?? []).filter(Boolean).join(' ').toLowerCase();
  if (labels) for (const [cat, re] of CATEGORY_RULES) if (re.test(labels)) return cat;
  if (input.ngo) return 'ngo';
  const lead = (input.description ?? '').slice(0, 400).toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(lead)) return cat;
  return 'other';
}

// ---------------------------------------------------------------- duplicates

const COMPANY_SUFFIX = /\b(inc|incorporated|ltd|limited|llc|l\.l\.c|plc|gmbh|ag|sa|s\.a|bv|b\.v|corp|corporation|co|company|group|holdings|technologies|technology|labs|hq)\b\.?/g;

export function normCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((?:[^)]*?(remote|hybrid|anywhere|worldwide|m\/f\/d|f\/m\/d|m\/w\/d|w\/m\/d|all genders)[^)]*?)\)/g, ' ')
    .replace(/\s[-–—|,]\s*(remote|hybrid|anywhere|worldwide|full[- ]?time|part[- ]?time|contract)\b.*$/g, ' ')
    .replace(/\b(sr)\b\.?/g, 'senior')
    .replace(/\b(jr)\b\.?/g, 'junior')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim();
}

/** company|title|place. Remote jobs share one place so copies on different boards meet. */
export function dedupeKey(company: string, title: string, isRemote: boolean, countries: string[]): string {
  const place = isRemote ? 'remote' : countries.slice().sort().join(',') || 'unknown';
  return `${normCompany(company)}|${normTitle(title)}|${place}`;
}
