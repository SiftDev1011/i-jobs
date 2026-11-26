-- =============================================================================
-- 0008: company logos on jobs
-- =============================================================================

-- The logo a job source gives for the company (https only). Shown on job cards and job pages;
-- the web app falls back to a lettered tile when there is none or it fails to load.
ALTER TABLE jobs ADD COLUMN company_logo_url text
  CONSTRAINT jobs_company_logo_https CHECK (company_logo_url IS NULL OR (company_logo_url ~ '^https://' AND length(company_logo_url) <= 1000));

-- Jobs already held: take the logo from the primary source's stored payload, where that source has one.
UPDATE jobs j SET company_logo_url = l.url
FROM (
  SELECT js.job_id,
         CASE rp.source_key
           WHEN 'himalayas'  THEN rp.payload->>'companyLogo'
           WHEN 'jobicy'     THEN rp.payload->>'companyLogo'
           WHEN 'remoteok'   THEN coalesce(nullif(rp.payload->>'company_logo', ''), rp.payload->>'logo')
           WHEN 'remotive'   THEN coalesce(nullif(rp.payload->>'company_logo', ''), rp.payload->>'company_logo_url')
           WHEN 'getonboard' THEN rp.payload #>> '{attributes,company,data,attributes,logo}'
           WHEN 'theirstack' THEN rp.payload #>> '{company_object,logo}'
         END AS url
  FROM job_sources js
  JOIN raw_postings rp ON rp.id = js.raw_posting_id
  WHERE js.is_primary
) l
WHERE l.job_id = j.id AND l.url ~ '^https://' AND length(l.url) <= 1000;
