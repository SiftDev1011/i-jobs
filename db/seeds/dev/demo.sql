-- Demo data for local development: a demo owner, two verified communities and 20 live jobs.
-- Never run this in production. Safe to run again: it skips rows that already exist.
BEGIN;
INSERT INTO users (id, email, email_verified_at, full_name, date_of_birth, age_band) VALUES ('11111111-1111-4111-8111-111111111111', 'owner@demo.ijobs.example', now(), 'Tunde Bello', '1990-03-14', 'adult') ON CONFLICT DO NOTHING;
INSERT INTO owner_profiles (user_id, legal_name, id_type, id_number_hash, payout_eligible) VALUES ('11111111-1111-4111-8111-111111111111', 'Tunde Bello', 'nin', 'demo-hash-1', true) ON CONFLICT DO NOTHING;
INSERT INTO communities (id, owner_user_id, name, slug, invite_code, description, status, price_kobo, platform_share_bps, trial_enabled) VALUES
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'Lagos Tech Hustlers', 'lagos-tech', 'LTH-2048', 'Remote tech and support jobs for people in Lagos and beyond. Shared daily, checked by the admins.', 'active', 500000, 3000, true),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Grad Jobs Africa', 'grad-jobs-africa', 'GJA-1100', 'Internships and graduate roles open to people across Africa.', 'active', 500000, 3000, false)
  ON CONFLICT DO NOTHING;
-- Keep older demo databases in line with the current share (30%).
UPDATE communities SET platform_share_bps = 3000
 WHERE id IN ('22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222');
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000001', 'greenhouse', 'demo-1', '{}', 'demo-1', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000001', 'Customer success associate', 'Kora Labs', $d$Kora Labs is hiring a customer success associate to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Zendesk, customer success
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Kora Labs is hiring a customer success associate.', 'worldwide', '{}', true, 'full_time', 120000, 150000, 'USD', 'month', ARRAY['zendesk','customer success','email support'], 'customer-support', 'email', 'jobs@koralabs.example', 'greenhouse', 'verified_employer', 'live', now() - interval '3 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000001', '44444444-4444-4444-8444-000000000001', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000002', 'lever', 'demo-2', '{}', 'demo-2', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000002', 'Junior data analyst', 'Tella', $d$Tella is hiring a junior data analyst to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Sql, excel
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Tella is hiring a junior data analyst.', 'restricted', '{NG,GH,KE}', true, 'full_time', 90000, 112500, 'USD', 'month', ARRAY['sql','excel','looker'], 'data', 'email', 'jobs@tella.example', 'lever', 'careers_page', 'live', now() - interval '6 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000002', '44444444-4444-4444-8444-000000000002', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000003', 'greenhouse', 'demo-3', '{}', 'demo-3', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000003', 'Operations coordinator', 'Sabi Logistics', $d$Sabi Logistics is hiring a operations coordinator to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Operations, google sheets
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Sabi Logistics is hiring a operations coordinator.', 'restricted', '{NG}', true, 'contract', 105000, 131250, 'USD', 'month', ARRAY['operations','google sheets'], 'operations', 'email', 'jobs@sabilogistics.example', 'greenhouse', 'verified_employer', 'live', now() - interval '9 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000003', '44444444-4444-4444-8444-000000000003', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000004', 'greenhouse', 'demo-4', '{}', 'demo-4', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000004', 'Programme assistant', 'Lumen Africa', $d$Lumen Africa is hiring a programme assistant to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Project coordination, reporting
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Lumen Africa is hiring a programme assistant.', 'restricted', '{NG,GH}', true, 'full_time', 140000, 175000, 'USD', 'month', ARRAY['project coordination','reporting'], 'operations', 'email', 'jobs@lumenafrica.example', 'greenhouse', 'careers_page', 'live', now() - interval '12 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000004', '44444444-4444-4444-8444-000000000004', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000005', 'lever', 'demo-5', '{}', 'demo-5', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000005', 'Junior product designer', 'Northwind Studio', $d$Northwind Studio is hiring a junior product designer to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Figma, ui design
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Northwind Studio is hiring a junior product designer.', 'worldwide', '{}', true, 'full_time', 130000, 162500, 'USD', 'month', ARRAY['figma','ui design','prototyping'], 'design', 'email', 'jobs@northwindstudio.example', 'lever', 'verified_employer', 'live', now() - interval '15 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000005', '44444444-4444-4444-8444-000000000005', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000006', 'greenhouse', 'demo-6', '{}', 'demo-6', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000006', 'Content writer', 'Brightpath Health', $d$Brightpath Health is hiring a content writer to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Writing, seo
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Brightpath Health is hiring a content writer.', 'worldwide', '{}', true, 'part_time', 70000, 87500, 'USD', 'month', ARRAY['writing','seo','health'], 'writing', 'email', 'jobs@brightpathhealth.example', 'greenhouse', 'careers_page', 'live', now() - interval '18 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000006', '44444444-4444-4444-8444-000000000006', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000007', 'employer_post', 'demo-7', '{}', 'demo-7', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000007', 'Support trainee', 'Paywise', $d$Paywise is hiring a support trainee to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Customer support, fintech
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Paywise is hiring a support trainee.', 'restricted', '{NG}', true, 'graduate', 35000000, 43750000, 'NGN', 'month', ARRAY['customer support','fintech'], 'customer-support', 'email', 'jobs@paywise.example', 'employer_post', 'verified_employer', 'live', now() - interval '21 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000007', '44444444-4444-4444-8444-000000000007', 'employer_post', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000008', 'lever', 'demo-8', '{}', 'demo-8', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000008', 'Data intern', 'Open Atlas', $d$Open Atlas is hiring a data intern to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Python, sql
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Open Atlas is hiring a data intern.', 'worldwide', '{}', true, 'internship', 40000, 50000, 'USD', 'month', ARRAY['python','sql'], 'data', 'email', 'jobs@openatlas.example', 'lever', 'careers_page', 'live', now() - interval '24 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000008', '44444444-4444-4444-8444-000000000008', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000009', 'greenhouse', 'demo-9', '{}', 'demo-9', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000009', 'Junior QA tester', 'Quillforge', $d$Quillforge is hiring a junior qa tester to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Manual testing, jira
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Quillforge is hiring a junior qa tester.', 'worldwide', '{}', true, 'contract', 65000, 81250, 'USD', 'month', ARRAY['manual testing','jira'], 'engineering', 'email', 'jobs@quillforge.example', 'greenhouse', 'careers_page', 'live', now() - interval '27 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000009', '44444444-4444-4444-8444-000000000009', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000010', 'lever', 'demo-10', '{}', 'demo-10', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000010', 'Community moderator', 'Chatbase', $d$Chatbase is hiring a community moderator to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Moderation, discord
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Chatbase is hiring a community moderator.', 'restricted', '{NG,KE}', true, 'part_time', 55000, 68750, 'USD', 'month', ARRAY['moderation','discord'], 'customer-support', 'email', 'jobs@chatbase.example', 'lever', 'careers_page', 'live', now() - interval '30 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000010', '44444444-4444-4444-8444-000000000010', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000011', 'greenhouse', 'demo-11', '{}', 'demo-11', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000011', 'Video editor', 'Mavo Media', $d$Mavo Media is hiring a video editor to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Premiere pro, after effects
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Mavo Media is hiring a video editor.', 'worldwide', '{}', true, 'freelance', 80000, 100000, 'USD', 'month', ARRAY['premiere pro','after effects'], 'design', 'email', 'jobs@mavomedia.example', 'greenhouse', 'careers_page', 'live', now() - interval '33 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000011', '44444444-4444-4444-8444-000000000011', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000012', 'employer_post', 'demo-12', '{}', 'demo-12', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000012', 'Bookkeeper', 'Halden Accounts', $d$Halden Accounts is hiring a bookkeeper to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Bookkeeping, quickbooks
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Halden Accounts is hiring a bookkeeper.', 'restricted', '{NG}', true, 'part_time', 25000000, 31250000, 'NGN', 'month', ARRAY['bookkeeping','quickbooks'], 'finance', 'email', 'jobs@haldenaccounts.example', 'employer_post', 'verified_employer', 'live', now() - interval '36 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000012', '44444444-4444-4444-8444-000000000012', 'employer_post', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000013', 'greenhouse', 'demo-13', '{}', 'demo-13', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000013', 'Frontend developer', 'Zuripay', $d$Zuripay is hiring a frontend developer to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- React, typescript
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Zuripay is hiring a frontend developer.', 'worldwide', '{}', true, 'full_time', 210000, 262500, 'USD', 'month', ARRAY['react','typescript','css'], 'engineering', 'email', 'jobs@zuripay.example', 'greenhouse', 'verified_employer', 'live', now() - interval '39 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000013', '44444444-4444-4444-8444-000000000013', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000014', 'lever', 'demo-14', '{}', 'demo-14', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000014', 'Virtual assistant', 'Atlas Founders', $d$Atlas Founders is hiring a virtual assistant to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Calendar management, email
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Atlas Founders is hiring a virtual assistant.', 'worldwide', '{}', true, 'part_time', 45000, 56250, 'USD', 'month', ARRAY['calendar management','email'], 'operations', 'email', 'jobs@atlasfounders.example', 'lever', 'careers_page', 'live', now() - interval '42 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000014', '44444444-4444-4444-8444-000000000014', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000015', 'greenhouse', 'demo-15', '{}', 'demo-15', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000015', 'Sales development rep', 'Gridsmith', $d$Gridsmith is hiring a sales development rep to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Outbound, hubspot
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Gridsmith is hiring a sales development rep.', 'restricted', '{NG,GH}', true, 'full_time', 95000, 118750, 'USD', 'month', ARRAY['outbound','hubspot'], 'sales', 'email', 'jobs@gridsmith.example', 'greenhouse', 'careers_page', 'live', now() - interval '45 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000015', '44444444-4444-4444-8444-000000000015', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000016', 'lever', 'demo-16', '{}', 'demo-16', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000016', 'UX researcher', 'Ember Labs', $d$Ember Labs is hiring a ux researcher to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- User interviews, usability testing
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Ember Labs is hiring a ux researcher.', 'worldwide', '{}', true, 'contract', 150000, 187500, 'USD', 'month', ARRAY['user interviews','usability testing'], 'design', 'email', 'jobs@emberlabs.example', 'lever', 'verified_employer', 'live', now() - interval '48 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000016', '44444444-4444-4444-8444-000000000016', 'lever', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000017', 'employer_post', 'demo-17', '{}', 'demo-17', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000017', 'Marketing intern', 'Remote Hustle', $d$Remote Hustle is hiring a marketing intern to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Social media, canva
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Remote Hustle is hiring a marketing intern.', 'restricted', '{NG}', true, 'internship', 15000000, 18750000, 'NGN', 'month', ARRAY['social media','canva'], 'marketing', 'email', 'jobs@remotehustle.example', 'employer_post', 'verified_employer', 'live', now() - interval '51 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000017', '44444444-4444-4444-8444-000000000017', 'employer_post', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000018', 'community_paste', 'demo-18', '{}', 'demo-18', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000018', 'Customer support representative', 'Paylite', $d$Paylite is hiring a customer support representative to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Zendesk, live chat
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Paylite is hiring a customer support representative.', 'restricted', '{NG}', true, 'full_time', 40000000, 50000000, 'NGN', 'month', ARRAY['zendesk','live chat'], 'customer-support', 'email', 'jobs@paylite.example', 'community_paste', 'unverified', 'live', now() - interval '54 hours', now() + interval '25 days', '22222222-2222-4222-8222-222222222221', now()) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000018', '44444444-4444-4444-8444-000000000018', 'community_paste', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000019', 'greenhouse', 'demo-19', '{}', 'demo-19', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000019', 'Backend engineer', 'Ledgerline', $d$Ledgerline is hiring a backend engineer to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Node.js, postgresql
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Ledgerline is hiring a backend engineer.', 'worldwide', '{}', true, 'full_time', 260000, 325000, 'USD', 'month', ARRAY['node.js','postgresql','typescript'], 'engineering', 'email', 'jobs@ledgerline.example', 'greenhouse', 'verified_employer', 'live', now() - interval '57 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000019', '44444444-4444-4444-8444-000000000019', 'greenhouse', true) ON CONFLICT DO NOTHING;
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-000000000020', 'employer_post', 'demo-20', '{}', 'demo-20', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, allowed_countries, is_remote, employment_type, salary_min_minor, salary_max_minor, salary_currency, salary_period, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, owner_confirmed_at) VALUES ('33333333-3333-4333-8333-000000000020', 'Social media manager', 'Kanu Foods', $d$Kanu Foods is hiring a social media manager to join a remote team.

What you'll do
- Work with a friendly, distributed team
- Own your work from start to finish
- Share progress in writing every week

What you need
- Instagram, tiktok
- Clear written English
- A reliable internet connection

This is a demo listing for local development.$d$, 'Kanu Foods is hiring a social media manager.', 'restricted', '{NG}', true, 'full_time', 30000000, 37500000, 'NGN', 'month', ARRAY['instagram','tiktok','content planning'], 'marketing', 'email', 'jobs@kanufoods.example', 'employer_post', 'verified_employer', 'live', now() - interval '60 hours', now() + interval '25 days', NULL, NULL) ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-000000000020', '44444444-4444-4444-8444-000000000020', 'employer_post', true) ON CONFLICT DO NOTHING;
COMMIT;

-- A staff admin, to try the staff tools locally (sign in with this email; the code is in the engine log).
INSERT INTO users (id, email, email_verified_at, full_name, date_of_birth, age_band) VALUES ('22222222-2222-4222-8222-222222222222', 'staff@demo.ijobs.example', now(), 'Ngozi Admin', '1988-07-02', 'adult') ON CONFLICT DO NOTHING;
INSERT INTO staff_members (user_id, role) VALUES ('22222222-2222-4222-8222-222222222222', 'admin') ON CONFLICT DO NOTHING;

-- A pasted job waiting for the demo owner to check and publish (what the AI would have produced).
INSERT INTO raw_postings (id, source_key, external_id, payload, content_hash, status) VALUES ('44444444-4444-4444-8444-0000000000a1', 'community_paste', 'paste-demo-a1', '{"text":"demo"}', 'demo-paste-a1', 'extracted') ON CONFLICT DO NOTHING;
INSERT INTO jobs (id, title, company_name, description, summary, location_scope, is_remote, employment_type, skills, category, apply_method, apply_email, primary_source_key, trust, status, first_seen_at, expires_at, community_id, posted_by_user_id)
SELECT '33333333-3333-4333-8333-0000000000a1', 'Social media assistant', 'Kola Foods', $d$Kola Foods needs a social media assistant to plan and post content across Instagram and TikTok.

What you'll do
- Plan a weekly content calendar
- Reply to comments and messages
- Report on what worked

Apply by email with links to accounts you have run.$d$, 'Plan and post content for a food brand.', 'worldwide', true, 'part_time', '{instagram,tiktok,canva}', 'marketing', 'email', 'jobs@kolafoods.example', 'community_paste', 'unverified', 'live', now(), now() + interval '21 days', c.id, '11111111-1111-4111-8111-111111111111'
  FROM communities c WHERE c.slug = 'lagos-tech'
ON CONFLICT DO NOTHING;
INSERT INTO job_sources (job_id, raw_posting_id, source_key, is_primary) VALUES ('33333333-3333-4333-8333-0000000000a1', '44444444-4444-4444-8444-0000000000a1', 'community_paste', true) ON CONFLICT DO NOTHING;
