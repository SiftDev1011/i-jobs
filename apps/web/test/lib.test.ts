import { describe, expect, it } from './runner';
import { companyTile, jobBadge, money, payLabel, timeAgo, typeLabel, whereLabel } from '../src/lib/format';
import { safeNext, secondsLeft } from '../src/lib/session';

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

describe('session helpers', () => {
  it('reads how long a token has left without trusting it', () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(secondsLeft(jwt({ exp: now / 1000 + 300 }), now)).toBe(300);
    expect(secondsLeft(jwt({ exp: now / 1000 - 5 }), now)).toBe(0);
    expect(secondsLeft('garbage', now)).toBe(0);
    expect(secondsLeft(undefined, now)).toBe(0);
  });

  it('only redirects to paths on this site after sign-in', () => {
    expect(safeNext('/join/LTH-2048')).toBe('/join/LTH-2048');
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('/\\evil.example')).toBe('/app');
    expect(safeNext(undefined)).toBe('/app');
  });
});

describe('formatting', () => {
  it('makes stable company tiles', () => {
    expect(companyTile('Kora Labs').initials).toBe('KL');
    expect(companyTile('Tella').initials).toBe('TE');
    expect(companyTile('Kora Labs').colour).toBe(companyTile('Kora Labs').colour);
  });

  it('formats pay ranges compactly', () => {
    expect(payLabel({ min_minor: 35000000, max_minor: 45000000, currency: 'NGN', period: 'month' })).toEqual({ amount: '₦350K–₦450K', period: 'a month' });
    expect(payLabel({ min_minor: 120000, max_minor: 120000, currency: 'USD', period: 'month' })).toEqual({ amount: '$1,200', period: 'a month' });
    expect(payLabel({ currency: 'USD' })).toBeNull();
    expect(money(500000, 'NGN')).toBe('₦5,000');
  });

  it('describes where a job is open', () => {
    expect(whereLabel({ location_scope: 'worldwide' })).toBe('Worldwide');
    expect(whereLabel({ location_scope: 'restricted', allowed_countries: ['NG'] })).toBe('Remote in Nigeria');
    expect(whereLabel({ location_scope: 'restricted', allowed_countries: ['NG', 'GH'] })).toBe('Remote: NG, GH');
    expect(whereLabel({ location_scope: 'restricted', allowed_regions: ['africa'] })).toBe('Remote in Africa');
    expect(typeLabel('part_time')).toBe('Part time');
  });

  it('picks the one badge that matters most', () => {
    expect(jobBadge({ trust: 'verified_employer', badges: ['new_today'] })?.label).toBe('Verified employer');
    expect(jobBadge({ trust: 'unverified', badges: ['closes_soon', 'new_today'] })?.label).toBe('Closes soon');
    expect(jobBadge({ trust: 'unverified', badges: [] })).toBeNull();
  });

  it('says how long ago', () => {
    const now = Date.UTC(2026, 10, 20, 12);
    expect(timeAgo(new Date(now - 30_000).toISOString(), now)).toBe('just now');
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3h ago');
    expect(timeAgo(new Date(now - 2 * 86400_000).toISOString(), now)).toBe('2d ago');
  });
});
