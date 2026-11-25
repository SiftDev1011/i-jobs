// Runs the migration and seed on an in-memory PostgreSQL (PGlite + pgvector)
// and checks the rules the database is responsible for.
// Usage: npm install && npm test
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { strict as assert } from 'node:assert'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

const here = dirname(fileURLToPath(import.meta.url))
const sql = (p) => readFileSync(join(here, '..', p), 'utf8')

const db = new PGlite({ extensions: { vector, citext, pg_trgm } })
let passed = 0
const results = []
async function test(name, fn) {
  try { await fn(); passed++; results.push(`  ok  ${name}`) }
  catch (e) { results.push(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1 }
}
const one = async (q, params) => (await db.query(q, params)).rows[0]
async function rejects(q, params, pattern) {
  try { await db.query(q, params) } catch (e) {
    if (pattern && !pattern.test(e.message)) throw new Error(`wrong error: ${e.message}`)
    return
  }
  throw new Error('expected the database to refuse this, but it was accepted')
}

const files = (dir) => readdirSync(join(here, '..', dir)).filter((f) => f.endsWith('.sql')).sort()
for (const f of files('migrations')) await db.exec(sql(`migrations/${f}`))
for (const f of files('seeds')) await db.exec(sql(`seeds/${f}`))
for (const f of files('seeds')) await db.exec(sql(`seeds/${f}`)) // re-running the seeds is safe

// ---------------------------------------------------------------- fixtures
const ijobs = await one(`select id from sites where slug = 'ijobs'`)
const rh = await one(`select id from sites where slug = 'remote-hustle'`)
const owner = await one(`insert into users (email, full_name, phone) values ('owner@example.com', 'Tunde Bello', '+2348010000001') returning id`)
await db.query(`insert into owner_profiles (user_id, legal_name, id_type, id_number_hash) values ($1, 'Tunde Bello', 'NIN', 'hash-nin-1')`, [owner.id])
const comm = await one(`insert into communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps, trial_enabled)
                        values ($1, 'Lagos Tech Hustlers', 'lagos-tech', 'LTH-2048', 600000, 2500, true) returning id`, [owner.id])
const ada = await one(`insert into users (email, full_name, phone) values ('ada@example.com', 'Ada Okafor', '+2348020000002') returning id`)

// ---------------------------------------------------------------- tests
await test('Seeds load: 3 sites, 24 outside sources plus 3 of our own', async () => {
  assert.equal(Number((await one(`select count(*) c from sites`)).c), 3)
  assert.equal(Number((await one(`select count(*) c from sources where kind not in ('community_paste','employer_post','platform_post')`)).c), 24)
  assert.equal(Number((await one(`select count(*) c from sources where kind in ('community_paste','employer_post','platform_post')`)).c), 3)
})

await test('Remotive and Himalayas stay on the free job finds page only', async () => {
  const rows = (await db.query(`select key, display, allow_paywall, allow_signup_gate from sources where key in ('remotive','himalayas') order by key`)).rows
  for (const r of rows) {
    assert.equal(r.display, 'job_finds_only'); assert.equal(r.allow_paywall, false); assert.equal(r.allow_signup_gate, false)
  }
})

await test('AI plan fits inside each Groq free model with 10% spare', async () => {
  const rows = (await db.query(`select * from ai_budget_plan_check`)).rows
  for (const r of rows) assert.ok(r.headroom >= 0, `${r.model_key} is over by ${-r.headroom}`)
})

await test('Community price below N5,000 is refused', async () => {
  await rejects(`insert into communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps)
                 values ($1, 'Cheap', 'cheap', 'CHP-1', 400000, 2500)`, [owner.id], /price_kobo/)
})

await test('Demo tours stop at two', async () => {
  await db.query(`update communities set demo_tours_used = 2 where id = $1`, [comm.id])
  await rejects(`update communities set demo_tours_used = 3 where id = $1`, [comm.id], /demo_tours_used/)
})

await test('One free trial per person, checked by phone and card', async () => {
  const m = await one(`insert into memberships (user_id, community_id, status, source, trial_started_at, trial_ends_at)
                       values ($1, $2, 'trialing', 'invite_link', now(), now() + interval '7 days') returning id`, [ada.id, comm.id])
  await db.query(`insert into trial_claims (user_id, membership_id, phone_hash, card_fingerprint) values ($1, $2, 'ph-ada', 'card-ada')`, [ada.id, m.id])
  const other = await one(`insert into users (email) values ('ada.second@example.com') returning id`)
  const m2 = await one(`insert into communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps, trial_enabled)
                        values ($1, 'Grad Jobs Africa', 'grad-jobs', 'GJA-1', 500000, 2500, true) returning id`, [owner.id])
  const mem2 = await one(`insert into memberships (user_id, community_id, status, source) values ($1, $2, 'pending_payment', 'invite_code') returning id`, [other.id, m2.id])
  await rejects(`insert into trial_claims (user_id, membership_id, phone_hash, card_fingerprint) values ($1, $2, 'ph-new', 'card-ada')`, [other.id, mem2.id], /card_fingerprint/)
  await rejects(`insert into trial_claims (user_id, membership_id, phone_hash) values ($1, $2, 'ph-ada')`, [other.id, mem2.id], /phone_hash/)
})

await test('Referral credit is permanent unless the community is banned', async () => {
  await db.query(`update users set referred_by_community_id = $1 where id = $2`, [comm.id, ada.id])
  const other = await one(`insert into communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps)
                           values ($1, 'Abuja Remote Workers', 'abuja-remote', 'ARW-1', 500000, 2500) returning id`, [owner.id])
  await rejects(`update users set referred_by_community_id = $1 where id = $2`, [other.id, ada.id], /stays credited/)
})

await test('Selar codes: single use, and voided with frozen payouts when the owner is banned', async () => {
  const banned = await one(`insert into communities (owner_user_id, name, slug, invite_code, price_kobo, platform_share_bps)
                            values ($1, 'Naija Designers Hub', 'naija-design', 'NDH-1', 750000, 2500) returning id`, [owner.id])
  const batch = await one(`insert into code_batches (community_id, quantity, unit_share_kobo, terms_accepted_at, created_by)
                           values ($1, 3, 150000, now(), $2) returning id, total_kobo`, [banned.id, owner.id])
  assert.equal(Number(batch.total_kobo), 450000)
  for (const c of ['SEL-AAA1', 'SEL-AAA2', 'SEL-AAA3'])
    await db.query(`insert into access_codes (code, batch_id, community_id) values ($1, $2, $3)`, [c, batch.id, banned.id])
  await rejects(`insert into access_codes (code, batch_id, community_id) values ('sel-aaa1', $1, $2)`, [batch.id, banned.id], /duplicate key/)
  await db.query(`update access_codes set status = 'redeemed', redeemed_by = $1, redeemed_at = now() where code = 'SEL-AAA1'`, [ada.id])
  await db.query(`insert into payouts (community_id, amount_kobo, hold_until) values ($1, 100000, now() + interval '14 days')`, [banned.id])
  await db.query(`update communities set status = 'banned' where id = $1`, [banned.id])
  const codes = (await db.query(`select code, status from access_codes where batch_id = $1 order by code`, [batch.id])).rows
  assert.deepEqual(codes.map(c => c.status), ['redeemed', 'void', 'void'])
  assert.equal((await one(`select status from payouts where community_id = $1`, [banned.id])).status, 'frozen')
})

await test('Jobs cannot stay up past 60 days', async () => {
  await rejects(`insert into jobs (company_name, title, description, apply_method, apply_url, primary_source_key, first_seen_at, expires_at)
                 values ('Kora Labs', 'Support', 'x', 'external_link', 'https://k', 'greenhouse', now(), now() + interval '61 days')`, [], /jobs_max_60_days/)
})

let job
await test('Never apply to the same job twice, and every status change is logged', async () => {
  job = await one(`insert into jobs (company_name, title, description, apply_method, apply_email, primary_source_key, trust, status, expires_at, location_scope)
                   values ('Kora Labs', 'Customer success associate', 'Help customers by chat', 'email', 'jobs@kora.example',
                           'greenhouse', 'careers_page', 'live', now() + interval '30 days', 'worldwide') returning id`)
  await db.query(`insert into sending_domains (domain, purpose, daily_limit) values ('apply.test', 'relay', 2) on conflict do nothing`)
  const relay = await one(`insert into relay_addresses (user_id, local_part, domain) values ($1, 'ada.okafor', 'apply.test') returning id`, [ada.id])
  const app = await one(`insert into applications (user_id, job_id, site_id, mode, channel, relay_address_id, cancel_until)
                         values ($1, $2, $3, 'autopilot', 'email_relay', $4, now() + interval '30 minutes') returning id`, [ada.id, job.id, ijobs.id, relay.id])
  await rejects(`insert into applications (user_id, job_id, site_id, mode, channel, relay_address_id, cancel_until)
                 values ($1, $2, $3, 'autopilot', 'email_relay', $4, now())`, [ada.id, job.id, ijobs.id, relay.id], /applications_once_per_job/)
  await db.query(`update applications set status = 'sent', sent_at = now() where id = $1`, [app.id])
  const ev = (await db.query(`select from_status, to_status from application_events where application_id = $1 order by id`, [app.id])).rows
  assert.deepEqual(ev.map(e => `${e.from_status}->${e.to_status}`), ['null->scheduled', 'scheduled->sent'])
})

await test('Autopilot cannot use an external link', async () => {
  const j2 = await one(`insert into jobs (company_name, title, description, apply_method, apply_url, primary_source_key, expires_at)
                        values ('Tella', 'Data analyst', 'x', 'external_link', 'https://t', 'jooble', now() + interval '20 days') returning id`)
  await rejects(`insert into applications (user_id, job_id, site_id, mode, channel, cancel_until)
                 values ($1, $2, $3, 'autopilot', 'external', now())`, [ada.id, j2.id, ijobs.id], /applications_autopilot_channels/)
})

await test('Sending limits stop at the cap', async () => {
  const r = []
  for (let i = 0; i < 3; i++) r.push((await one(`select try_count_send('domain', 'apply.test', 2) ok`)).ok)
  assert.deepEqual(r, [true, true, false])
})

await test('AI budget: reserve, settle, and stop when the day is spent', async () => {
  const day = '2030-01-01'
  const m = (await one(`select ai_reserve('cv_parse', 3000, $1::date) m`, [day])).m
  assert.equal(m, 'groq:openai/gpt-oss-20b')
  await db.query(`select ai_settle($1::date, $2, 'cv_parse', 3000, 2100, 500)`, [day, m])
  const u = await one(`select reserved_tokens, used_input_tokens, used_output_tokens from ai_usage_daily where day = $1 and task = 'cv_parse'`, [day])
  assert.deepEqual([u.reserved_tokens, u.used_input_tokens, u.used_output_tokens], [0, 2100, 500])
  // cv_parse has 50,000 a day; 47,400 left, so one 47,000 call fits and the next does not.
  assert.ok((await one(`select ai_reserve('cv_parse', 47000, $1::date) m`, [day])).m)
  assert.equal((await one(`select ai_reserve('cv_parse', 1000, $1::date) m`, [day])).m, null)
})

await test('AI budget: preview model falls back to gpt-oss-20b when it is switched off', async () => {
  const day = '2030-01-02'
  await db.query(`update ai_models set enabled = false where key = 'groq:qwen/qwen3.8-27b'`)
  const m = (await one(`select ai_reserve('reply_sort', NULL, $1::date) m`, [day])).m
  assert.equal(m, 'groq:openai/gpt-oss-20b')
  await db.query(`update ai_models set enabled = true where key = 'groq:qwen/qwen3.8-27b'`)
})

await test('AI budget: a model never goes past its own daily limit', async () => {
  const day = '2030-01-03'
  // gpt-oss-120b keeps 180,000 usable tokens; app_paragraph is allowed all of them.
  let calls = 0
  while ((await one(`select ai_reserve('app_paragraph', 1400, $1::date) m`, [day])).m) calls++
  assert.equal(calls, Math.floor(180000 / 1400))
})

await test('Owners see first names and progress only, never contact details', async () => {
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'owner_member_list'`)).rows.map(r => r.column_name)
  for (const hidden of ['email', 'phone', 'full_name', 'cv_file_key']) assert.ok(!cols.includes(hidden), `${hidden} is visible`)
  const row = await one(`select first_name from owner_member_list where community_id = $1`, [comm.id])
  assert.equal(row.first_name, 'Ada')
  const f = await one(`select joined, on_trial, stuck_no_cv from community_funnel where community_id = $1`, [comm.id])
  assert.deepEqual([Number(f.joined), Number(f.on_trial), Number(f.stuck_no_cv)], [1, 1, 1])
})

await test('Ledger: each money event balances to zero', async () => {
  const pay = await one(`insert into payments (user_id, community_id, membership_id, purpose, amount_kobo, provider_ref, status, paid_at)
                         select $1, $2, id, 'membership', 600000, 'PAGA-1', 'succeeded', now() from memberships where user_id = $1 and community_id = $2 returning id`, [ada.id, comm.id])
  const txn = '00000000-0000-0000-0000-000000000001'
  await db.query(`insert into ledger_entries (txn_id, account, payment_id, community_id, amount_kobo) values
    ($1, 'cash', $2, null, 600000),
    ($1, 'platform_revenue', $2, null, -150000),
    ($1, 'owner_payable', $2, $3, -450000)`, [txn, pay.id, comm.id]) // debits positive, credits negative, as the engine writes them
  assert.equal(Number((await one(`select count(*) c from ledger_unbalanced`)).c), 0)
  assert.equal(Number((await one(`select balance_kobo from owner_balances where community_id = $1`, [comm.id])).balance_kobo), 450000)
})

await test('Site isolation: a partner only sees its own rows', async () => {
  await db.query(`insert into notifications (user_id, site_id, type, title) values ($1, $2, 'interview_invite', 'Tella replied'), ($1, $3, 'daily_summary', 'RH summary')`, [ada.id, ijobs.id, rh.id])
  await db.exec(`create role ijobs_api nologin; grant select on notifications to ijobs_api;`)
  await db.exec(`begin; set local role ijobs_api; set local app.site_id = '${ijobs.id}';`)
  const seen = (await db.query(`select title from notifications`)).rows.map(r => r.title)
  await db.exec(`commit;`)
  assert.deepEqual(seen, ['Tella replied'])
})

await test('Matching index: nearest jobs by meaning (pgvector)', async () => {
  const v = (x) => `[${Array.from({ length: 1024 }, (_, i) => (i === x ? 1 : 0)).join(',')}]`
  await db.query(`update jobs set embedding = $1 where id = $2`, [v(0), job.id])
  const r = await one(`select title, 1 - (embedding <=> $1) as similarity from jobs where embedding is not null order by embedding <=> $1 limit 1`, [v(0)])
  assert.equal(r.title, 'Customer success associate')
  assert.ok(Number(r.similarity) > 0.99)
})

console.log(results.join('\n'))
const tables = (await one(`select count(*) c from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).c
const views = (await one(`select count(*) c from information_schema.views where table_schema = 'public'`)).c
console.log(`\n${passed} of ${results.length} checks passed. Schema: ${tables} tables, ${views} views.`)
