import { tagLocation } from '../src/ingest/location';
import { categorise, dedupeKey, employmentType, payFromNumbers, payFromText, seniority } from '../src/ingest/normalise';
import { regionsOf } from '../src/ingest/places';
import { screen, SCAM_BLOCK, SCAM_REVIEW, textHash } from '../src/ingest/scam';
import { htmlToText, toDate } from '../src/ingest/text';

describe('location tags', () => {
  const t = (texts: string[], extra = {}) => tagLocation({ texts, ...extra });

  it.each([
    [['Remote'], { isRemote: true, scope: 'unspecified', countries: [], regions: [] }],
    [['Anywhere in the world'], { isRemote: true, scope: 'worldwide' }],
    [['Remote - Worldwide'], { isRemote: true, scope: 'worldwide' }],
    [['Remote (EMEA)'], { isRemote: true, scope: 'restricted', regions: ['emea'] }],
    [['Remote, Africa'], { scope: 'restricted', regions: ['africa'] }],
    [['Remote - US'], { isRemote: true, scope: 'restricted', countries: ['US'] }],
    [['Lagos, Nigeria'], { isRemote: false, scope: 'restricted', countries: ['NG'] }],
    [['Hybrid - Nairobi'], { isRemote: false, countries: ['KE'] }],
    [['Austin, TX'], { isRemote: false, countries: ['US'] }],
    [['Toronto, ON'], { countries: ['CA'] }],
    [['Equatorial Guinea'], { countries: ['GQ'] }],
    [['Remote (Nigeria, Ghana, Kenya)'], { scope: 'restricted', countries: ['GH', 'KE', 'NG'] }],
    [['Remote, anywhere in Europe'], { scope: 'restricted', regions: ['europe'] }],
    [['Tbilisi, Georgia'], { countries: ['GE'] }],
    [['Atlanta, Georgia'], { countries: ['US'] }],
    [['Indiana'], { countries: ['US'] }],
    [['India'], { countries: ['IN'] }],
    [['Remote, UK'], { countries: ['GB'] }],
  ])('%j', (texts, expected) => {
    expect(t(texts as string[])).toMatchObject(expected);
  });

  it('reads time zones', () => {
    expect(t(['Remote (UTC-3 to UTC+3)'])).toMatchObject({ tzMin: -3, tzMax: 3 });
    expect(t(['Remote, GMT+1 ± 2 hours'])).toMatchObject({ tzMin: -1, tzMax: 3 });
    expect(t(['Remote (CET)'])).toMatchObject({ tzMin: 1, tzMax: 1 });
    expect(t(['Remote'], { tzOffsets: [0, 1, 2] })).toMatchObject({ tzMin: 0, tzMax: 2 });
  });

  it('trusts what the source says over words', () => {
    expect(t(['Lagos'], { workplace: 'remote' })).toMatchObject({ isRemote: true, countries: ['NG'], scope: 'restricted' });
    expect(t(['Remote'], { workplace: 'hybrid' }).isRemote).toBe(false);
    expect(t([], { remoteSource: true })).toMatchObject({ isRemote: true, scope: 'unspecified' });
    expect(t([], { countries: ['NGA', 'Kenya', 'gh'] }).countries).toEqual(['GH', 'KE', 'NG']);
  });

  it('knows which regions a country is in', () => {
    expect(regionsOf('NG')).toEqual(expect.arrayContaining(['africa', 'emea']));
    expect(regionsOf('EG')).toEqual(expect.arrayContaining(['africa', 'mena']));
  });
});

describe('normalising', () => {
  it('employment type', () => {
    expect(employmentType('FullTime')).toBe('full_time');
    expect(employmentType('fulltime_permanent')).toBe('full_time');
    expect(employmentType('Part-time')).toBe('part_time');
    expect(employmentType('Intern')).toBe('internship');
    expect(employmentType(['Contractor'])).toBe('contract');
    expect(employmentType('NYSC Graduate Programme')).toBe('graduate');
    expect(employmentType('')).toBeNull();
  });

  it('seniority from the title', () => {
    expect(seniority('Sr. Backend Engineer')).toBe('senior');
    expect(seniority('Junior Designer')).toBe('junior');
    expect(seniority('Head of Growth')).toBe('director');
    expect(seniority('Customer Support Agent')).toBeNull();
  });

  it('pay from numbers, in minor units', () => {
    expect(payFromNumbers(50000, 70000, 'USD', 'year')).toEqual({ minMinor: 5_000_000, maxMinor: 7_000_000, currency: 'USD', period: 'year' });
    expect(payFromNumbers(90000, null, 'usd', null)).toMatchObject({ minMinor: 9_000_000, period: 'year' });
    expect(payFromNumbers(null, null, 'USD', null).currency).toBeNull();
    expect(payFromNumbers(10, 5, 'EUR', 'hour')).toMatchObject({ minMinor: 500, maxMinor: 1000 });
  });

  it('pay from text', () => {
    expect(payFromText('$50k - $70k a year')).toEqual({ minMinor: 5_000_000, maxMinor: 7_000_000, currency: 'USD', period: 'year' });
    expect(payFromText('₦300,000/month')).toEqual({ minMinor: 30_000_000, maxMinor: null, currency: 'NGN', period: 'month' });
    expect(payFromText('USD 25-35 per hour')).toMatchObject({ minMinor: 2500, maxMinor: 3500, period: 'hour' });
    expect(payFromText('Competitive')).toMatchObject({ currency: null });
  });

  it('categories', () => {
    expect(categorise({ title: 'Senior Data Engineer', employment: 'full_time' })).toBe('data');
    expect(categorise({ title: 'Backend Developer (Go)', employment: null })).toBe('engineering');
    expect(categorise({ title: 'Customer Support Specialist', employment: null })).toBe('customer-support');
    expect(categorise({ title: 'Marketing Intern', employment: 'internship' })).toBe('internships');
    expect(categorise({ title: 'Account Executive', employment: null })).toBe('sales');
    expect(categorise({ title: 'Accountant', employment: null })).toBe('finance');
    expect(categorise({ title: 'Programme Officer', employment: null, ngo: true })).toBe('ngo');
    expect(categorise({ title: 'Ninja', employment: null, sourceLabels: ['Software Development'] })).toBe('engineering');
  });

  it('duplicate keys ignore suffixes and remote tags', () => {
    const a = dedupeKey('Acme, Inc.', 'Sr. Frontend Engineer (Remote)', true, []);
    const b = dedupeKey('ACME', 'Senior Frontend Engineer - Remote', true, ['US']);
    expect(a).toBe(b);
    expect(a).toBe('acme|senior frontend engineer|remote');
    expect(dedupeKey('Acme', 'Cashier', false, ['NG'])).not.toBe(dedupeKey('Acme', 'Cashier', false, ['KE']));
  });
});

describe('text', () => {
  it('turns HTML (even double-escaped) into readable text', () => {
    expect(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;')).toBe('Hello & welcome\n\n• One');
    expect(htmlToText('<p>A<br>B</p><script>x()</script><p>C&nbsp;&#8211; D</p>')).toBe('A\nB\n\nC – D');
  });

  it('reads many date shapes', () => {
    expect(toDate(1731456000)?.toISOString()).toBe('2024-11-13T00:00:00.000Z');
    expect(toDate(1731456000000)?.toISOString()).toBe('2024-11-13T00:00:00.000Z');
    expect(toDate('2026-11-01 10:00:00')?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(toDate('Tue, 13 Aug 2024 07:43:23 GMT')?.toISOString()).toBe('2024-08-13T07:43:23.000Z');
    expect(toDate('nonsense')).toBeNull();
  });
});

describe('scam rules', () => {
  const base = { title: 'Customer Support Agent', company: 'Acme', description: 'Help our customers by email and chat. '.repeat(10) };

  it('passes a normal job', () => {
    expect(screen(base).score).toBeLessThan(SCAM_REVIEW);
  });

  it('blocks fee requests with chat-only contact', () => {
    const r = screen({ ...base, description: `${base.description} Pay a one-time registration fee of ₦5,000. Contact us on WhatsApp to start.` });
    expect(r.score).toBeGreaterThanOrEqual(SCAM_BLOCK);
    expect(r.reasons).toEqual(expect.arrayContaining(['asks_for_money', 'chat_only_contact']));
  });

  it('sends unclear cases to review', () => {
    const r = screen({ ...base, description: `${base.description} Message us on Telegram to apply.`, applyEmail: 'acme.hr@gmail.com' });
    expect(r.score).toBeGreaterThanOrEqual(SCAM_REVIEW);
    expect(r.score).toBeLessThan(SCAM_BLOCK);
  });

  it('fingerprints ignore links and punctuation', () => {
    expect(textHash('Earn $500 daily!! https://a.example/x')).toBe(textHash('earn $500 daily https://b.example/y'));
  });
});
