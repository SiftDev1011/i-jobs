'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { act, e164, list, text, type Result } from '@/lib/act';
import { engine, EngineError, must } from '@/lib/engine';
import { POLICY_VERSION } from '@/lib/labels';
import type { components } from '@/lib/api-types';

type S = components['schemas'];
export type { Result };

// ---------------------------------------------------------------- account

export async function updateMe(_: unknown, f: FormData) {
  const body: { full_name?: string; date_of_birth?: string } = {};
  if (f.has('full_name')) body.full_name = text(f, 'full_name');
  if (text(f, 'date_of_birth')) body.date_of_birth = text(f, 'date_of_birth');
  return act(async () => { must(await (await engine()).PATCH('/me', { body })); return undefined; }, ['/app', '/app/settings']);
}


/** Saves the phone number and texts it a code (for the free week). */
export async function sendPhoneCode(phoneRaw: string): Promise<Result<{ phone: string }>> {
  const phone = e164(phoneRaw);
  if (!phone) return { ok: false, error: 'Enter a phone number like 0803 123 4567.', field: 'phone' };
  return act(async () => {
    const api = await engine();
    must(await api.PATCH('/me', { body: { phone } }));
    must(await api.POST('/auth/codes', { body: { target: phone, channel: 'sms' } }));
    return { phone };
  });
}

export async function startTrial(membershipId: string, code: string) {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'Enter the 6-digit code from the text message.', field: 'code' } as const;
  return act(async () => {
    must(await (await engine()).POST('/memberships/{membershipId}/trial', { params: { path: { membershipId } }, body: { phone_verification_code: code } }));
    return undefined;
  }, '/app');
}

export async function askGuardian(_: unknown, f: FormData) {
  return act(async () => {
    must(await (await engine()).POST('/me/guardian', { body: { guardian_name: text(f, 'guardian_name'), guardian_email: text(f, 'guardian_email') } }));
    return undefined;
  }, '/app');
}

// ---------------------------------------------------------------- CV and profile

const CV_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;

export async function cvUploadLink(file: { name: string; type: string; size: number }): Promise<Result<{ upload_id: string; upload_url: string }>> {
  const type = CV_TYPES.find((t) => t === file.type);
  if (!type) return { ok: false, error: 'Upload your CV as a PDF or a Word (.docx) file.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'That file is over 5 MB. Save a smaller copy and try again.' };
  return act(async () => {
    const r = must(await (await engine()).POST('/me/cv', { body: { file_name: file.name.slice(0, 200), content_type: type, size_bytes: file.size } }));
    return { upload_id: r.upload_id, upload_url: r.upload_url };
  });
}

export async function cvParse(uploadId: string) {
  return act(async () => must(await (await engine()).POST('/me/cv/parse', { body: { upload_id: uploadId } })));
}

/** For the upload page to poll: when the profile was last built from a CV. */
export async function cvParsedAt(): Promise<string | null> {
  const r = await (await engine()).GET('/me/profile');
  return r.data?.cv?.parsed_at ?? null;
}

export async function saveProfile(_: unknown, f: FormData) {
  const body: S['ProfileInput'] = {
    headline: text(f, 'headline'),
    summary: text(f, 'summary'),
    years_experience: f.get('years_experience') ? Number(f.get('years_experience')) : undefined,
    country: text(f, 'country').toUpperCase() || undefined,
    city: text(f, 'city') || undefined,
    skills: list(text(f, 'skills')).slice(0, 60),
    languages: list(text(f, 'languages')).slice(0, 20),
    links: list(text(f, 'links')).slice(0, 10),
    work_authorization: { remote_any_country: f.get('remote_any_country') === 'on', countries: list(text(f, 'auth_countries').toUpperCase()).slice(0, 30) },
    experience: (JSON.parse(text(f, 'experience') || '[]') as NonNullable<S['ProfileInput']['experience']>).map((j) => ({
      ...j, start: j.start || undefined, end: j.end || null, highlights: (j.highlights ?? []).map((h) => h.trim()).filter(Boolean),
    })),
    education: JSON.parse(text(f, 'education') || '[]'),
  };
  return act(async () => { must(await (await engine()).PATCH('/me/profile', { body })); return undefined; }, ['/app/profile', '/app']);
}

export async function confirmProfile() {
  return act(async () => { must(await (await engine()).POST('/me/profile/confirm')); return undefined; }, ['/app/profile', '/app']);
}

// ---------------------------------------------------------------- autopilot and consents

export async function setConsent(purpose: S['ConsentPurpose'], granted: boolean) {
  return act(async () => {
    must(await (await engine()).POST('/me/consents', { body: { purpose, granted, policy_version: POLICY_VERSION } }));
    return undefined;
  }, ['/app/settings', '/app/autopilot']);
}

export async function saveAutopilot(_: unknown, f: FormData) {
  const enabled = f.get('enabled') === 'on';
  const amount = Number(text(f, 'min_pay') || '0');
  const currency = text(f, 'currency') || 'NGN';
  const body: S['AutopilotRules'] = {
    enabled,
    min_match: Number(f.get('min_match') ?? 70),
    include_unspecified: f.get('include_unspecified') === 'on',
    daily_cap: Number(f.get('daily_cap') ?? 10),
    regions: f.getAll('regions').length ? f.getAll('regions').map(String) : ['worldwide'],
    employment_types: f.getAll('employment_types').map(String) as S['EmploymentType'][],
    ...(amount > 0 ? { min_pay_monthly: { amount_minor: Math.round(amount * 100), currency } } : {}),
    paused_until: text(f, 'paused_until') ? new Date(`${text(f, 'paused_until')}T23:59:59+01:00`).toISOString() : null,
  };
  return act(async () => {
    const api = await engine();
    if (enabled && f.get('consent') === 'on') {
      must(await api.POST('/me/consents', { body: { purpose: 'autopilot', granted: true, policy_version: POLICY_VERSION } }));
    }
    must(await api.PUT('/me/autopilot', { body }));
    return undefined;
  }, ['/app/autopilot', '/app']);
}

// ---------------------------------------------------------------- matches, queue, applications

export async function setMatch(jobId: string, status: 'seen' | 'saved' | 'dismissed') {
  // No refresh: the card stays where it is (a saved match would otherwise jump out of "New").
  return act(async () => { must(await (await engine()).PATCH('/me/matches/{jobId}', { params: { path: { jobId } }, body: { status } })); return undefined; });
}

export async function getPack(jobId: string): Promise<Result<{ pack: S['ApplyPack'] | null; work: S['QueuedWork'] | null }>> {
  return act(async () => {
    const r = await (await engine()).POST('/me/queue/{jobId}/pack', { params: { path: { jobId } } });
    if (r.response.status === 202) return { pack: null, work: (r.data as unknown as S['QueuedWork']) ?? null };
    return { pack: must(r) as S['ApplyPack'], work: null };
  });
}

export async function markApplied(jobId: string) {
  return act(async () => must(await (await engine()).POST('/me/queue/{jobId}/applied', { params: { path: { jobId } } })), ['/app/queue', '/app/applications']);
}

export async function cancelApplication(applicationId: string) {
  return act(async () => { must(await (await engine()).POST('/applications/{applicationId}/cancel', { params: { path: { applicationId } } })); return undefined; }, ['/app/applications', `/app/applications/${applicationId}`]);
}

export async function answerCheckin(applicationId: string, checkinId: string, answer: string) {
  return act(async () => {
    must(await (await engine()).POST('/applications/{applicationId}/checkins/{checkinId}', {
      params: { path: { applicationId, checkinId } }, body: { answer: answer as 'heard_back' },
    }));
    return undefined;
  }, ['/app/applications', `/app/applications/${applicationId}`]);
}

export async function reportJob(_: unknown, f: FormData) {
  const jobId = text(f, 'job_id');
  return act(async () => {
    must(await (await engine()).POST('/jobs/{jobId}/reports', { params: { path: { jobId } }, body: { reason: text(f, 'reason') as 'scam', details: text(f, 'details') || undefined } }));
    return undefined;
  });
}

// ---------------------------------------------------------------- notifications, help, privacy

export async function markNotificationsRead(ids?: string[]) {
  return act(async () => { must(await (await engine()).POST('/me/notifications/read', { body: ids?.length ? { ids } : {} })); return undefined; }, ['/app/notifications', '/app']);
}

export async function askHelp(question: string): Promise<Result<{ answer?: string; source?: string; ticket_id?: string | null }>> {
  const q = question.trim();
  if (q.length < 3) return { ok: false, error: 'Ask a question in a few words.' };
  return act(async () => {
    const r = await (await engine()).POST('/help/ask', { body: { question: q.slice(0, 1000) } });
    if (r.response.status === 202) {
      const w = r.data as unknown as S['QueuedWork'];
      return { ticket_id: w.ticket_id ?? w.work_id };
    }
    const a = must(r) as { answer: string; source: string; ticket_id?: string | null };
    return a;
  });
}

export async function createTicket(_: unknown, f: FormData) {
  const r = await act(async () => must(await (await engine()).POST('/support/tickets', {
    body: { subject: text(f, 'subject'), category: (text(f, 'category') || 'other') as 'other', message: text(f, 'message') },
  })));
  if (r.ok && r.data?.id) redirect(`/app/help/tickets/${r.data.id}`);
  return r;
}

export async function replyTicket(_: unknown, f: FormData) {
  const id = text(f, 'ticket_id');
  return act(async () => {
    must(await (await engine()).POST('/support/tickets/{ticketId}/messages', { params: { path: { ticketId: id } }, body: { body: text(f, 'body') } }));
    return undefined;
  }, `/app/help/tickets/${id}`);
}

export async function requestData(_: unknown, f: FormData) {
  const type = text(f, 'type') as 'export';
  if (type === ('delete' as string) && text(f, 'confirm') !== 'DELETE') return { ok: false, error: 'Type DELETE to confirm.', field: 'confirm' } as const;
  return act(async () => {
    must(await (await engine()).POST('/me/data-requests', { body: { type, details: text(f, 'details') || undefined } }));
    return undefined;
  }, '/app/settings');
}

export async function decidePartnerLink(token: string, accept: boolean) {
  const r = await act(async () => {
    const api = await engine();
    if (accept) must(await api.POST('/partner/links/{token}/accept', { params: { path: { token } } }));
    else must(await api.POST('/partner/links/{token}/decline', { params: { path: { token } } }));
    return undefined;
  });
  if (r.ok) redirect(accept ? '/app?linked=1' : '/app');
  return r;
}
