'use server';

import { redirect } from 'next/navigation';
import { act, list, text, toKobo, type Result } from '@/lib/act';
import { engine, must } from '@/lib/engine';

// ---------------------------------------------------------------- verification

export async function startEmployerCheck(_: unknown, f: FormData): Promise<Result<{ email: string }>> {
  let site = text(f, 'website_url');
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  const country = text(f, 'country').toUpperCase();
  return act(async () => {
    const r = must(await (await engine()).POST('/employers/verifications', {
      body: {
        company_name: text(f, 'company_name'), work_email: text(f, 'work_email').toLowerCase(), website_url: site,
        ...(text(f, 'registry_number') ? { registry_number: text(f, 'registry_number') } : {}),
        ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
      },
    }));
    return { email: r.sent_to ?? text(f, 'work_email') };
  });
}

export async function confirmEmployerCheck(email: string, _: unknown, f: FormData): Promise<Result> {
  const code = text(f, 'code').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code from the email.', field: 'code' };
  let id = '';
  const r = await act(async () => {
    id = must(await (await engine()).POST('/employers/verifications/confirm', { body: { work_email: email, code } })).id ?? '';
    return undefined;
  }, '/app');
  if (!r.ok) return r;
  redirect(`/app/employer/${id}?confirmed=1`);
}

// ---------------------------------------------------------------- jobs

const SCOPES = ['worldwide', 'restricted', 'unspecified'] as const;
const TYPES = ['full_time', 'part_time', 'contract', 'freelance', 'internship', 'graduate', 'temporary'] as const;
const PERIODS = ['hour', 'day', 'week', 'month', 'year', 'project'] as const;

export async function postEmployerJob(employerId: string, _: unknown, f: FormData): Promise<Result> {
  const scope = text(f, 'location_scope') as (typeof SCOPES)[number];
  const type = text(f, 'employment_type') as (typeof TYPES)[number];
  const per = text(f, 'pay_period') as (typeof PERIODS)[number];
  const currency = text(f, 'pay_currency').toUpperCase();
  const lo = toKobo(text(f, 'pay_min'));
  const hi = toKobo(text(f, 'pay_max'));
  const countries = list(text(f, 'allowed_countries').toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  const onPlatform = text(f, 'apply_how') !== 'link';
  let url = text(f, 'apply_url');
  if (url && !/^https:\/\//i.test(url)) url = `https://${url.replace(/^http:\/\//i, '')}`;
  const max = Number(text(f, 'max_applicants'));
  const deadline = text(f, 'deadline');

  if (!SCOPES.includes(scope)) return { ok: false, error: 'Choose who can apply.', field: 'location_scope' };
  if (scope === 'restricted' && !countries.length) return { ok: false, error: 'List the countries, like NG, GH, KE.', field: 'allowed_countries' };
  if (!onPlatform && !url) return { ok: false, error: 'Add the link people apply through.', field: 'apply_url' };
  if ((lo || hi) && !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'Choose the pay currency.', field: 'pay_currency' };

  let jobId = '';
  const r = await act(async () => {
    jobId = must(await (await engine()).POST('/employers/{employerId}/jobs', {
      params: { path: { employerId } },
      body: {
        title: text(f, 'title'), description: text(f, 'description'), location_scope: scope,
        ...(scope === 'restricted' ? { allowed_countries: countries } : {}),
        ...(TYPES.includes(type) ? { employment_type: type } : {}),
        ...(lo || hi ? { pay: { min_minor: lo, max_minor: hi, currency, period: PERIODS.includes(per) ? per : null } } : {}),
        skills: list(text(f, 'skills')).slice(0, 15),
        accept_on_platform: onPlatform,
        ...(onPlatform && text(f, 'apply_email') ? { apply_email: text(f, 'apply_email').toLowerCase() } : {}),
        ...(!onPlatform ? { apply_url: url } : {}),
        ...(Number.isInteger(max) && max > 0 ? { max_applicants: max } : {}),
        // End of the chosen day in Lagos.
        ...(deadline ? { deadline_at: `${deadline}T23:59:00+01:00` } : {}),
      },
    })).id;
    return undefined;
  });
  if (!r.ok) return r;
  redirect(`/app/employer/${employerId}?posted=${jobId}`);
}

// ---------------------------------------------------------------- ATS

export async function connectAts(employerId: string, _: unknown, f: FormData): Promise<Result> {
  const provider = text(f, 'provider') as 'greenhouse' | 'lever' | 'ashby';
  if (!['greenhouse', 'lever', 'ashby'].includes(provider)) return { ok: false, error: 'Choose your hiring system.', field: 'provider' };
  return act(async () => {
    must(await (await engine()).POST('/employers/{employerId}/integrations', { params: { path: { employerId } }, body: { provider, board_token: text(f, 'board_token'), api_key: text(f, 'api_key') } }));
    return undefined;
  }, `/app/employer/${employerId}`);
}

export async function disconnectAts(employerId: string, integrationId: string): Promise<Result> {
  return act(async () => {
    must(await (await engine()).DELETE('/employers/{employerId}/integrations/{integrationId}', { params: { path: { employerId, integrationId } } }));
    return undefined;
  }, `/app/employer/${employerId}`);
}

