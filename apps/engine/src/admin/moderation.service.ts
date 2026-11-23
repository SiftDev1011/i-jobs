import { Inject, Injectable } from '@nestjs/common';
import { ExpressionBuilder, sql } from 'kysely';
import { decodeCursor, page } from '../common/cursor';
import { Problem } from '../common/problem';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { textHash } from '../ingest/scam';

const STRIKES_TO_SUSPEND = 3;

/** The review queue: flagged jobs, new communities, employers awaiting a registry check. */
@Injectable()
export class ModerationService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async list(f: { subject?: string; status?: string; cursor?: string; limit: number }) {
    const after = decodeCursor(f.cursor);
    const rows = await this.db.asEngine((trx) => {
      let q = trx.selectFrom('moderation_items').selectAll().where('status', 'in', f.status ? [f.status as never] : ['open', 'in_review', 'escalated']);
      if (f.subject) q = q.where('subject_type', '=', f.subject as never);
      if (after) q = q.where((eb: ExpressionBuilder<any, any>) => eb.or([eb('created_at', '>', after.at), eb.and([eb('created_at', '=', after.at), eb('id', '>', after.id)])]));
      return q.orderBy('created_at').orderBy('id').limit(f.limit + 1).execute();
    });
    const p = page(rows, f.limit, (r) => ({ at: new Date(r.created_at as unknown as string).toISOString(), id: r.id }));
    const about = await this.describe(p.items);
    return { items: p.items.map((i) => ({ ...view(i), subject: about.get(i.subject_id) ?? null })), next_cursor: p.next_cursor };
  }

  /** What each item is about, in words, so a reviewer can decide without looking anything up. Staff only. */
  private async describe(items: { subject_type: string; subject_id: string }[]) {
    const ids = (t: string) => [...new Set(items.filter((i) => i.subject_type === t).map((i) => i.subject_id))];
    const out = new Map<string, { title: string; lines: string[]; links: string[]; text: string | null }>();
    const naira = (k: unknown) => `₦${(Number(k) / 100).toLocaleString('en-NG')}`;
    await this.db.asEngine(async (trx) => {
      const jobIds = ids('job');
      if (jobIds.length) {
        const jobs = await trx.selectFrom('jobs as j').leftJoin('communities as c', 'c.id', 'j.community_id').leftJoin('employers as e', 'e.id', 'j.employer_id')
          .select(['j.id', 'j.title', 'j.company_name', 'j.status', 'j.primary_source_key', 'j.apply_email', 'j.apply_url', 'j.description', 'j.report_count', 'c.name as community', 'e.verification as employer_verification'])
          .where('j.id', 'in', jobIds).execute();
        for (const j of jobs) {
          out.set(j.id, {
            title: `${j.title} at ${j.company_name}`,
            lines: [
              `Status: ${j.status}`, `Source: ${j.primary_source_key}`,
              ...(j.community ? [`Posted in ${j.community}`] : []),
              ...(j.employer_verification ? [`Employer: ${j.employer_verification}`] : []),
              ...(j.apply_email ? [`Applies by email to ${j.apply_email}`] : []),
              ...(Number(j.report_count) ? [`${j.report_count} member report(s)`] : []),
            ],
            links: j.apply_url ? [j.apply_url] : [],
            text: j.description ? j.description.slice(0, 4000) : null,
          });
        }
      }
      const communityIds = ids('community');
      if (communityIds.length) {
        const cs = await trx.selectFrom('communities as c').leftJoin('owner_profiles as o', 'o.user_id', 'c.owner_user_id')
          .select(['c.id', 'c.name', 'c.slug', 'c.status', 'c.description', 'c.proof_links', 'c.price_kobo', 'c.billing_period', 'c.strike_count', 'o.legal_name', 'o.id_type', 'o.bank_account_last4',
            (eb) => eb.selectFrom('community_verifications as v').select('v.claimed_member_count').whereRef('v.community_id', '=', 'c.id').orderBy('v.submitted_at', 'desc').limit(1).as('claimed'),
            (eb) => eb.selectFrom('community_verifications as v').select('v.group_started_on').whereRef('v.community_id', '=', 'c.id').orderBy('v.submitted_at', 'desc').limit(1).as('started')])
          .where('c.id', 'in', communityIds).execute();
        for (const c of cs) {
          const links = (Array.isArray(c.proof_links) ? c.proof_links : []) as string[];
          out.set(c.id, {
            title: `${c.name} (/${c.slug})`,
            lines: [
              `Status: ${c.status}`,
              ...(c.legal_name ? [`Owner: ${c.legal_name}${c.id_type ? ` (${String(c.id_type).replace(/_/g, ' ')})` : ''}`] : []),
              ...(c.claimed != null ? [`Says it has ${Number(c.claimed).toLocaleString('en-NG')} members`] : []),
              ...(c.started ? [`Group started ${new Date(c.started as unknown as string).toISOString().slice(0, 10)}`] : []),
              `Price ${naira(c.price_kobo)} ${c.billing_period}`,
              `Payout account: ${c.bank_account_last4 ? `ends ${c.bank_account_last4}` : 'not given'}`,
              ...(c.strike_count ? [`${c.strike_count} strike(s)`] : []),
            ],
            links: links.filter((l) => /^https:\/\//.test(l)),
            text: c.description,
          });
        }
      }
      const employerIds = ids('employer');
      if (employerIds.length) {
        const es = await trx.selectFrom('employers').select(['id', 'name', 'domain', 'website_url', 'country', 'registry_number', 'verification', 'checks']).where('id', 'in', employerIds).execute();
        for (const e of es) {
          const ch = e.checks as Record<string, boolean>;
          out.set(e.id, {
            title: `${e.name}${e.domain ? ` (${e.domain})` : ''}`,
            lines: [
              `Verification: ${e.verification}`,
              `Registry number: ${e.registry_number ?? 'not given'}${e.country ? ` (${e.country})` : ''}`,
              `Work email ${ch?.work_email ? 'confirmed' : 'not confirmed'}; website ${ch?.website ? 'checked' : 'not checked'}`,
            ],
            links: e.website_url ? [e.website_url] : [],
            text: null,
          });
        }
      }
      const people = [...ids('user'), ...ids('owner')];
      if (people.length) {
        const us = await trx.selectFrom('users').select(['id', 'full_name', 'status']).where('id', 'in', people).execute();
        for (const u of us) out.set(u.id, { title: u.full_name ?? 'A member', lines: [`Account: ${u.status}`], links: [], text: null });
      }
    });
    return out;
  }

  /**
   * approve: the subject goes (or stays) live. reject: removed. reject_as_scam: also added to the scam
   * list and everyone who applied is warned. strike: the posting community gets a strike; three suspend it.
   */
  async decide(itemId: string, staffId: string, d: { decision: 'approve' | 'reject' | 'reject_as_scam' | 'escalate'; note?: string; strike?: boolean }) {
    return this.db.asEngine(async (trx) => {
      const item = await trx.selectFrom('moderation_items').selectAll().where('id', '=', itemId).forUpdate().executeTakeFirst();
      if (!item) throw Problem.notFound('item_not_found', 'There is no review item here');
      if (item.status === 'approved' || item.status === 'rejected') throw Problem.conflict('already_decided', 'This item has already been decided');
      const status = d.decision === 'approve' ? 'approved' : d.decision === 'escalate' ? 'escalated' : 'rejected';

      if (item.subject_type === 'job' && d.decision !== 'escalate') {
        const job = await trx.selectFrom('jobs').select(['id', 'description', 'community_id', 'title', 'company_name', 'owner_confirmed_at', 'primary_source_key']).where('id', '=', item.subject_id).executeTakeFirst();
        if (job) {
          if (d.decision === 'approve') {
            // Pasted jobs still wait for their owner's confirmation.
            const waitsForOwner = job.primary_source_key === 'community_paste' && !job.owner_confirmed_at;
            if (!waitsForOwner) await trx.updateTable('jobs').set({ status: 'live' }).where('id', '=', job.id).where('status', 'in', ['pending_review', 'scam']).execute();
          } else {
            const scam = d.decision === 'reject_as_scam';
            await trx.updateTable('jobs').set({ status: scam ? 'scam' : 'removed', closed_reason: scam ? 'moderation:scam' : 'moderation:removed' }).where('id', '=', job.id).execute();
            if (scam) {
              await trx.insertInto('scam_signatures').values({ text_hash: textHash(job.description), example_job_id: job.id, confirmed_by: staffId }).onConflict((oc) => oc.column('text_hash').doNothing()).execute();
              // Stop anything still waiting to go, and warn everyone who applied.
              await trx.updateTable('applications').set({ status: 'cancelled', cancelled_at: sql`now()`, failed_reason: 'job_removed_as_scam' }).where('job_id', '=', job.id).where('status', '=', 'scheduled').execute();
              const applicants = await trx.selectFrom('applications').select(['user_id', 'site_id']).where('job_id', '=', job.id).where('status', '!=', 'cancelled').execute();
              for (const a of applicants) {
                await trx.insertInto('notifications').values({
                  user_id: a.user_id, site_id: a.site_id, type: 'job.scam_alert', title: 'A job you applied to was removed',
                  body: `We found that "${job.title}" at ${job.company_name} looks like a scam. Don't send money, your BVN, bank or card details. If you already did, contact your bank and our support.`,
                  data: JSON.stringify({ job_id: job.id }),
                }).execute();
              }
            }
            if (d.strike && job.community_id) await this.strike(trx, job.community_id, staffId, d.note ?? (scam ? 'scam job posted' : 'job removed by moderators'));
          }
        }
      }
      // A strike appeal: upholding the appeal takes the strike back, and lifts a suspension it caused.
      const appeal = item.subject_type === 'community' ? /^strike appeal ([0-9a-f-]{36})$/.exec(item.reason_internal ?? '') : null;
      if (appeal && d.decision !== 'escalate') {
        const upheld = d.decision === 'approve';
        const s = await trx.updateTable('community_strikes').set({ appeal_decision: upheld ? 'approved' : 'rejected' }).where('id', '=', appeal[1]).where('appeal_decision', '=', 'pending').returning('community_id').executeTakeFirst();
        if (s && upheld) {
          await trx.updateTable('communities').set({
            strike_count: sql`greatest(strike_count - 1, 0)`,
            status: sql`CASE WHEN status = 'suspended' AND strike_count - 1 < ${STRIKES_TO_SUSPEND} THEN 'active'::community_status ELSE status END`,
          }).where('id', '=', s.community_id).execute();
        }
      }
      if (item.subject_type === 'employer' && d.decision === 'approve') {
        // A person checked the company registry: with the email and website checks, it's verified.
        await trx.updateTable('employers').set({
          checks: sql`checks || '{"registry": true}'::jsonb`,
          verification: sql`CASE WHEN (checks->>'work_email')::boolean AND (checks->>'website')::boolean THEN 'verified'::verification_status ELSE verification END`,
          verified_at: sql`CASE WHEN (checks->>'work_email')::boolean AND (checks->>'website')::boolean THEN now() ELSE verified_at END`,
          verified_via: 'domain_email + website + registry',
        }).where('id', '=', item.subject_id).execute();
      }

      await trx.updateTable('moderation_items').set({ status, decided_by: staffId, decided_at: sql`now()`, decision_note: d.note ?? null }).where('id', '=', itemId).execute();
      await trx.insertInto('audit_log').values({ actor_user_id: staffId, actor_kind: 'staff', action: `moderation.${d.decision}`, subject_type: item.subject_type, subject_id: item.subject_id, meta: JSON.stringify({ item: itemId, note: d.note ?? null, strike: !!d.strike }) }).execute();
      return view(await trx.selectFrom('moderation_items').selectAll().where('id', '=', itemId).executeTakeFirstOrThrow());
    });
  }

  private async strike(trx: Parameters<Parameters<Db['asEngine']>[0]>[0], communityId: string, staffId: string, reason: string) {
    await trx.insertInto('community_strikes').values({ community_id: communityId, reason, issued_by: staffId }).execute();
    const c = await trx.updateTable('communities').set({ strike_count: sql`strike_count + 1` }).where('id', '=', communityId).returning(['strike_count', 'status']).executeTakeFirstOrThrow();
    if (c.strike_count >= STRIKES_TO_SUSPEND && c.status === 'active') {
      await trx.updateTable('communities').set({ status: 'suspended' }).where('id', '=', communityId).execute();
      await trx.insertInto('moderation_items').values({ subject_type: 'community', subject_id: communityId, reason_internal: `${c.strike_count} strikes: suspended, decide whether to ban` }).execute();
    }
  }
}

function view(i: any) {
  return {
    id: i.id, subject_type: i.subject_type, subject_id: i.subject_id, reason_internal: i.reason_internal,
    risk_score: i.risk_score === null ? null : Number(i.risk_score), status: i.status, created_at: new Date(i.created_at).toISOString(),
  };
}
