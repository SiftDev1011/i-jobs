'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { act, checked, e164, list, text, toKobo, type Result } from '@/lib/act';
import { engine, must } from '@/lib/engine';

type Period = 'monthly' | 'quarterly' | 'yearly';
const PERIODS: Period[] = ['monthly', 'quarterly', 'yearly'];
const period = (v: string): Period => (PERIODS.includes(v as Period) ? (v as Period) : 'monthly');
const base = (id: string) => `/app/owner/${id}`;

// ---------------------------------------------------------------- applying

const ID_TYPES = ['nin', 'passport', 'drivers_licence', 'voters_card'] as const;

/** Sends a new community for review. Identity and bank details are hashed by the engine, never shown back. */
export async function applyOwner(_: unknown, f: FormData): Promise<Result> {
  const price = toKobo(text(f, 'price'));
  if (!price) return { ok: false, error: 'Enter the monthly price in naira.', field: 'price' };
  const proof = list(text(f, 'proof_links')).map((l) => (/^https?:\/\//i.test(l) ? l.replace(/^http:/i, 'https:') : `https://${l}`));
  if (!proof.length) return { ok: false, error: 'Add at least one WhatsApp or Telegram group link.', field: 'proof_links' };
  const idType = text(f, 'id_type') as (typeof ID_TYPES)[number];
  if (!ID_TYPES.includes(idType)) return { ok: false, error: 'Choose an ID type.', field: 'id_type' };
  const account = text(f, 'bank_account_number').replace(/\D/g, '');
  if (account && account.length !== 10) return { ok: false, error: 'Use the 10-digit account number.', field: 'bank_account_number' };
  if (account && !text(f, 'bank_code')) return { ok: false, error: 'Choose the bank for this account.', field: 'bank_code' };
  if (!checked(f, 'agree')) return { ok: false, error: 'Agree to the community owner rules to continue.', field: 'agree' };
  const claimed = Number(text(f, 'claimed_member_count').replace(/\D/g, ''));

  let id = '';
  const r = await act(async () => {
    const c = must(await (await engine()).POST('/owner/applications', {
      body: {
        legal_name: text(f, 'legal_name'),
        id_type: idType,
        id_number: text(f, 'id_number'),
        ...(account ? { bank_code: text(f, 'bank_code'), bank_account_number: account } : {}),
        community_name: text(f, 'community_name'),
        slug: text(f, 'slug').toLowerCase(),
        ...(text(f, 'description') ? { description: text(f, 'description') } : {}),
        proof_links: proof,
        ...(claimed ? { claimed_member_count: claimed } : {}),
        ...(text(f, 'group_started_on') ? { group_started_on: text(f, 'group_started_on') } : {}),
        price: { amount_minor: price, currency: 'NGN' },
        billing_period: period(text(f, 'billing_period')),
        trial_enabled: checked(f, 'trial_enabled'),
        approval_required: checked(f, 'approval_required'),
      },
    }));
    id = c.id ?? '';
    return undefined;
  });
  if (!r.ok) return r;
  redirect(`${base(id)}?applied=1`);
}

// ---------------------------------------------------------------- settings

export async function updateCommunity(id: string, _: unknown, f: FormData): Promise<Result> {
  const price = toKobo(text(f, 'price'));
  if (!price) return { ok: false, error: 'Enter the price in naira.', field: 'price' };
  return act(async () => {
    must(await (await engine()).PATCH('/owner/communities/{communityId}', {
      params: { path: { communityId: id } },
      body: {
        description: text(f, 'description'),
        price: { amount_minor: price, currency: 'NGN' },
        billing_period: period(text(f, 'billing_period')),
        trial_enabled: checked(f, 'trial_enabled'),
        approval_required: checked(f, 'approval_required'),
      },
    }));
    return undefined;
  }, [base(id), `${base(id)}/settings`]);
}

// ---------------------------------------------------------------- members

export async function decideMember(id: string, membershipId: string, what: 'approve' | 'decline' | 'nudge'): Promise<Result> {
  return act(async () => {
    const api = await engine();
    const params = { path: { communityId: id, membershipId } };
    if (what === 'approve') must(await api.POST('/owner/communities/{communityId}/members/{membershipId}/approve', { params }));
    if (what === 'decline') must(await api.POST('/owner/communities/{communityId}/members/{membershipId}/decline', { params }));
    if (what === 'nudge') must(await api.POST('/owner/communities/{communityId}/members/{membershipId}/nudge', { params }));
    return undefined;
    // A reminder changes nothing on the page but the button, which shows "Reminder sent" itself.
  }, what === 'nudge' ? [] : [`${base(id)}/members`, base(id)]);
}

// ---------------------------------------------------------------- invites

export async function sendInvites(id: string, _: unknown, f: FormData): Promise<Result<{ queued: number; skipped: number; invalid: string[] }>> {
  const raw = text(f, 'targets').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  if (!raw.length) return { ok: false, error: 'Paste at least one email address.', field: 'targets' };
  if (raw.length > 500) return { ok: false, error: 'Send up to 500 at a time.', field: 'targets' };
  // Local numbers become +234…; emails pass as they are; the engine reports anything else as invalid.
  const targets = [...new Set(raw.map((t) => (t.includes('@') ? t.toLowerCase() : e164(t) ?? t)))];
  return act(async () => {
    const r = must(await (await engine()).POST('/owner/communities/{communityId}/invites', { params: { path: { communityId: id } }, body: { targets } }));
    return { queued: r.queued ?? 0, skipped: r.skipped_duplicates ?? 0, invalid: r.invalid ?? [] };
  }, `${base(id)}/invites`);
}

export async function startDemoTour(id: string): Promise<Result<{ url: string; left: number }>> {
  return act(async () => {
    const r = must(await (await engine()).POST('/owner/communities/{communityId}/demo-tours', { params: { path: { communityId: id } } }));
    return { url: r.demo_url ?? '', left: r.tours_left ?? 0 };
  }, base(id));
}

// ---------------------------------------------------------------- jobs

export async function pasteJob(id: string, _: unknown, f: FormData): Promise<Result<{ later: string | null }>> {
  const t = text(f, 'text');
  if (t.length < 40) return { ok: false, error: 'Paste the whole job post (at least a few lines).', field: 'text' };
  return act(async () => {
    const r = must(await (await engine()).POST('/owner/communities/{communityId}/jobs', { params: { path: { communityId: id } }, body: { text: t } }));
    return { later: r.scheduled_for ?? null };
  }, `${base(id)}/jobs`);
}

export async function confirmJob(id: string, jobId: string, _: unknown, f: FormData): Promise<Result> {
  const how = text(f, 'apply_to');
  const email = how.includes('@') && !/^https?:/i.test(how) ? how : null;
  const url = email ? null : how ? (/^https?:\/\//i.test(how) ? how : `https://${how}`) : null;
  if (!how) return { ok: false, error: 'Add the email or link people apply through.', field: 'apply_to' };
  return act(async () => {
    must(await (await engine()).POST('/owner/communities/{communityId}/jobs/{jobId}/confirm', {
      params: { path: { communityId: id, jobId } },
      body: { title: text(f, 'title'), company_name: text(f, 'company_name'), description: text(f, 'description'), ...(email ? { apply_email: email } : { apply_url: url! }) },
    }));
    return undefined;
  }, `${base(id)}/jobs`);
}

export async function renewJob(id: string, jobId: string): Promise<Result> {
  return act(async () => {
    must(await (await engine()).POST('/owner/communities/{communityId}/jobs/{jobId}/renew', { params: { path: { communityId: id, jobId } } }));
    return undefined;
  }, `${base(id)}/jobs`);
}

// ---------------------------------------------------------------- strikes

export async function appealStrike(id: string, strikeId: string, _: unknown, f: FormData): Promise<Result> {
  const reason = text(f, 'reason');
  if (reason.length < 10) return { ok: false, error: 'Tell us what happened in a sentence or two.', field: 'reason' };
  return act(async () => {
    must(await (await engine()).POST('/owner/communities/{communityId}/strikes/{strikeId}/appeal', { params: { path: { communityId: id, strikeId } }, body: { reason } }));
    return undefined;
  }, base(id));
}

// ---------------------------------------------------------------- Selar codes

export async function buyCodes(id: string, _: unknown, f: FormData): Promise<Result> {
  const quantity = Number(text(f, 'quantity'));
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return { ok: false, error: 'Choose between 1 and 10,000 codes.', field: 'quantity' };
  if (!checked(f, 'accept_terms')) return { ok: false, error: 'Tick the box to accept that codes never expire and can’t be refunded.', field: 'accept_terms' };
  let url = '';
  const r = await act(async () => {
    const res = must(await (await engine()).POST('/owner/communities/{communityId}/code-batches', {
      params: { path: { communityId: id }, header: { 'Idempotency-Key': text(f, 'idem') || randomUUID() } },
      body: { quantity, accept_terms: true },
    }));
    url = res.checkout?.checkout_url ?? '';
    return undefined;
  });
  if (!r.ok) return r;
  redirect(url || `${base(id)}/codes`);
}
