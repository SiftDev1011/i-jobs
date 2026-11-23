'use server';

import { act, checked, text, type Result } from '@/lib/act';
import { engine, must } from '@/lib/engine';
import type { components } from '@/lib/api-types';

type Decision = 'approve' | 'reject' | 'reject_as_scam' | 'escalate';

const DECISIONS: Decision[] = ['approve', 'reject', 'reject_as_scam', 'escalate'];

export async function decideItem(itemId: string, _: unknown, f: FormData): Promise<Result> {
  const decision = text(f, 'decision') as Decision;
  if (!DECISIONS.includes(decision)) return { ok: false, error: 'Choose a decision.' };
  return act(async () => {
    must(await (await engine()).POST('/admin/moderation/{itemId}/decision', {
      params: { path: { itemId } },
      body: { decision, ...(text(f, 'note') ? { note: text(f, 'note') } : {}), ...(checked(f, 'strike') ? { strike: true } : {}) },
    }));
    return undefined;
  });
}

export async function verifyCommunity(communityId: string, _: unknown, f: FormData): Promise<Result> {
  const decision = text(f, 'decision') as 'approved' | 'rejected' | 'needs_more_info';
  if (!['approved', 'rejected', 'needs_more_info'].includes(decision)) return { ok: false, error: 'Choose a decision.' };
  const note = text(f, 'note');
  if (decision !== 'approved' && note.length < 5) return { ok: false, error: 'Write a note for the owner: it goes in the email they get.', field: 'note' };
  return act(async () => {
    must(await (await engine()).POST('/admin/communities/{communityId}/verify', { params: { path: { communityId } }, body: { decision, ...(note ? { note } : {}) } }));
    return undefined;
  });
}

export async function banCommunity(communityId: string, _: unknown, f: FormData): Promise<Result> {
  const reason = text(f, 'reason');
  if (reason.length < 5) return { ok: false, error: 'Write why. It is kept in the audit log.', field: 'reason' };
  if (text(f, 'confirm') !== 'BAN') return { ok: false, error: 'Type BAN to confirm.', field: 'confirm' };
  return act(async () => {
    must(await (await engine()).POST('/admin/communities/{communityId}/ban', { params: { path: { communityId } }, body: { reason } }));
    return undefined;
  });
}

const TAKEDOWN = ['scam', 'closed', 'terms', 'duplicate', 'other'] as const;
export async function takedownJob(_: unknown, f: FormData): Promise<Result> {
  const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text(f, 'job'));
  const reason = text(f, 'reason') as (typeof TAKEDOWN)[number];
  if (!m) return { ok: false, error: 'Paste the job link or its id.', field: 'job' };
  if (!TAKEDOWN.includes(reason)) return { ok: false, error: 'Choose a reason.', field: 'reason' };
  return act(async () => {
    must(await (await engine()).POST('/admin/jobs/{jobId}/takedown', { params: { path: { jobId: m[0].toLowerCase() } }, body: { reason } }));
    return undefined;
  });
}

export async function staffReply(ticketId: string, _: unknown, f: FormData): Promise<Result> {
  const body = text(f, 'body');
  if (!body) return { ok: false, error: 'Write a reply.', field: 'body' };
  return act(async () => {
    must(await (await engine()).POST('/admin/support/tickets/{ticketId}/messages', { params: { path: { ticketId } }, body: { body, resolve: checked(f, 'resolve') } }));
    return undefined;
  }, [`/app/admin/support/${ticketId}`, '/app/admin/support']);
}

export async function closeDataRequest(requestId: string, status: 'done' | 'refused', _: unknown, f: FormData): Promise<Result> {
  return act(async () => {
    must(await (await engine()).POST('/admin/data-requests/{requestId}', { params: { path: { requestId } }, body: { status, ...(text(f, 'note') ? { note: text(f, 'note') } : {}) } }));
    return undefined;
  }, '/app/admin/data-requests');
}

export async function releasePayout(payoutId: string): Promise<Result> {
  return act(async () => {
    must(await (await engine()).POST('/admin/payouts/{payoutId}/release', { params: { path: { payoutId } } }));
    return undefined;
  }, '/app/admin/payouts');
}

export async function markPayoutPaid(payoutId: string, _: unknown, f: FormData): Promise<Result> {
  const reference = text(f, 'reference');
  if (reference.length < 4) return { ok: false, error: 'Enter the bank transfer reference.', field: 'reference' };
  return act(async () => {
    must(await (await engine()).POST('/admin/payouts/{payoutId}/paid', { params: { path: { payoutId } }, body: { reference } }));
    return undefined;
  }, '/app/admin/payouts');
}

type Rules = components['schemas']['SourceRulesInput'];
export async function updateSource(key: string, _: unknown, f: FormData): Promise<Result> {
  const interval = Number(text(f, 'fetch_interval_minutes'));
  const maxDay = text(f, 'max_fetches_per_day');
  const body: Rules = {
    enabled: checked(f, 'enabled'),
    display: text(f, 'display') as Rules['display'],
    terms_status: text(f, 'terms_status') as Rules['terms_status'],
    allow_paywall: checked(f, 'allow_paywall'),
    allow_autopilot: checked(f, 'allow_autopilot'),
    allow_signup_gate: checked(f, 'allow_signup_gate'),
    apply_via_source_link: checked(f, 'apply_via_source_link'),
    requires_credit: checked(f, 'requires_credit'),
    credit_text: text(f, 'credit_text') || null,
    ...(Number.isInteger(interval) && interval >= 5 ? { fetch_interval_minutes: interval } : {}),
    max_fetches_per_day: maxDay ? Number(maxDay) : null,
    notes: text(f, 'notes') || null,
  };
  return act(async () => {
    must(await (await engine()).PATCH('/admin/sources/{sourceKey}', { params: { path: { sourceKey: key } }, body }));
    return undefined;
  }, '/app/admin/sources');
}
