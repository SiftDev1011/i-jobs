/**
 * Sample responses in each source's documented shape (trimmed to one or two jobs).
 * Keyed by a URL fragment; the fake fetch serves the first fragment the URL contains.
 */
export const FIXTURES: [string, string | object][] = [
  // ---------------------------------------------------------------- ATS
  ['boards-api.greenhouse.io/v1/boards/acme/jobs', {
    jobs: [{
      id: 4012345, internal_job_id: 99, title: 'Senior Backend Engineer', updated_at: '2026-11-10T09:00:00-05:00',
      first_published: '2026-11-09T12:00:00-05:00', company_name: 'Acme',
      location: { name: 'Remote - EMEA' }, absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/4012345',
      content: '&lt;p&gt;Build our payments API.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;li&gt;PostgreSQL&lt;/li&gt;&lt;/ul&gt;',
      departments: [{ id: 1, name: 'Engineering' }], offices: [{ id: 2, name: 'Remote', location: 'Remote' }], metadata: [],
    }],
    meta: { total: 1 },
  }],
  ['api.lever.co/v0/postings/acme', [{
    id: 'a1b2c3d4-0000-4000-8000-000000000001', text: 'Customer Support Specialist',
    hostedUrl: 'https://jobs.lever.co/acme/a1b2c3d4', applyUrl: 'https://jobs.lever.co/acme/a1b2c3d4/apply',
    createdAt: 1794218400000, workplaceType: 'remote', country: 'NG',
    categories: { commitment: 'Full-time', department: 'Support', location: 'Lagos, Nigeria', team: 'CX', allLocations: ['Lagos, Nigeria'] },
    descriptionPlain: 'Help our customers by chat and email.', description: '<p>Help our customers by chat and email.</p>',
    lists: [{ text: 'You will', content: '<li>Answer tickets</li><li>Write help articles</li>' }],
    additionalPlain: 'We pay in USD.', salaryRange: { min: 1000, max: 1500, currency: 'USD', interval: 'per-month-salary' },
  }]],
  ['api.ashbyhq.com/posting-api/job-board/acme', {
    apiVersion: '1',
    jobs: [
      {
        id: '2b7a-0001', title: 'Product Designer', department: 'Design', team: 'Product', employmentType: 'FullTime',
        location: 'Remote', secondaryLocations: [{ location: 'Nairobi, Kenya' }], isRemote: true, workplaceType: 'Remote',
        publishedAt: '2026-11-12T10:00:00.000+00:00', isListed: true,
        jobUrl: 'https://jobs.ashbyhq.com/acme/2b7a-0001', applyUrl: 'https://jobs.ashbyhq.com/acme/2b7a-0001/application',
        descriptionPlain: 'Design flows for our mobile app, from research to polished screens.', descriptionHtml: '<p>Design flows for our mobile app, from research to polished screens.</p>',
        compensation: { summaryComponents: [{ compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 40000, maxValue: 60000 }] },
      },
      { id: 'hidden-1', title: 'Hidden', isListed: false, jobUrl: 'https://jobs.ashbyhq.com/acme/hidden-1' },
    ],
  }],
  ['acme.bamboohr.com/careers/list', {
    meta: { totalCount: 2 },
    result: [
      { id: '17', jobOpeningName: 'Bookkeeper', departmentLabel: 'Finance', employmentStatusLabel: 'Part-Time', location: { city: 'Accra', state: null }, atsLocation: { country: 'Ghana', city: 'Accra' }, isRemote: null, locationType: '0' },
      { id: '18', jobOpeningName: 'Known role', departmentLabel: 'Ops', employmentStatusLabel: 'Full-Time', location: {}, atsLocation: {}, isRemote: true, locationType: '1' },
    ],
  }],
  ['acme.bamboohr.com/careers/17/detail', {
    meta: {}, result: { jobOpening: { jobOpeningName: 'Bookkeeper', description: '<p>Keep our books.</p>', datePosted: '2026-11-01', jobOpeningShareUrl: 'https://acme.bamboohr.com/careers/17', compensation: 'GHS 4,000 - 5,000 per month' } },
  }],
  ['portal.api.gupy.io/api/v1/jobs', {
    data: [
      { id: 555, name: 'Desenvolvedor Full Stack', description: '<p>Trabalho remoto.</p>', careerPageName: 'acme', jobUrl: 'https://acme.gupy.io/jobs/555', type: 'vacancy_type_effective', publishedDate: '2026-11-05T00:00:00.000Z', applicationDeadline: '2026-12-05', isRemoteWork: true, city: 'São Paulo', state: 'SP', country: 'Brasil', workplaceType: 'remote' },
      { id: 556, name: 'Other company job', careerPageName: 'other', jobUrl: 'https://other.gupy.io/jobs/556' },
    ],
    pagination: { offset: 0, limit: 100, total: 2 },
  }],
  ['acme.jobs.personio.de/xml', `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>1234</id><subcompany>Acme GmbH</subcompany><office>Berlin</office><department>Data</department>
    <recruitingCategory>Data</recruitingCategory><name>Data Analyst (m/f/d)</name>
    <jobDescriptions>
      <jobDescription><name>Your tasks</name><value><![CDATA[<p>Build dashboards.</p>]]></value></jobDescription>
      <jobDescription><name>Your profile</name><value><![CDATA[<ul><li>SQL</li></ul>]]></value></jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType><seniority>experienced</seniority><schedule>full-time</schedule>
    <createdAt>2026-11-03T09:00:00+00:00</createdAt>
  </position>
</workzag-jobs>`],
  ['acme.recruitee.com/api/offers', {
    offers: [{
      id: 777, title: 'Sales Development Representative', status: 'published', company_name: 'Acme',
      description: '<p>Book meetings.</p>', requirements: '<p>Great English.</p>', location: 'Remote', city: '', country: '',
      country_code: '', remote: true, careers_url: 'https://acme.recruitee.com/o/sdr', careers_apply_url: 'https://acme.recruitee.com/o/sdr/c/new',
      employment_type_code: 'fulltime_permanent', published_at: '2026-11-11 08:00:00 UTC', salary: { min: '800', max: '1200', currency: 'USD', period: 'month' },
      department: 'Sales',
    }],
  }],
  ['acme.teamtailor.com/jobs.rss', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations">
<channel><title>Acme jobs</title>
<item>
  <title>Content Writer</title>
  <description><![CDATA[<p>Write our blog.</p>]]></description>
  <pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate>
  <link>https://acme.teamtailor.com/jobs/42-content-writer</link>
  <guid isPermaLink="false">acme-42</guid>
  <remoteStatus>fully</remoteStatus>
  <tt:locations><tt:location><tt:city>Cape Town</tt:city><tt:country>South Africa</tt:country></tt:location></tt:locations>
</item>
</channel></rss>`],
  ['apply.workable.com/api/v1/widget/accounts/acme', {
    name: 'Acme Ltd',
    jobs: [{
      title: 'Virtual Assistant', shortcode: 'ABC123', employment_type: 'Contract', telecommuting: true,
      department: 'Operations', url: 'https://apply.workable.com/j/ABC123', application_url: 'https://apply.workable.com/j/ABC123/apply',
      published_on: '2026-11-08', country: 'Nigeria', city: 'Lagos', state: 'Lagos',
      locations: [{ country: 'Nigeria', countryCode: 'NG', city: 'Lagos', region: 'Lagos' }],
      description: '<p>Manage calendars and inboxes.</p>',
    }],
  }],

  // ---------------------------------------------------------------- remote boards
  ['himalayas.app/jobs/api', {
    offset: 0, limit: 20, totalCount: 1,
    jobs: [{
      title: 'Frontend Engineer', excerpt: 'React role', companyName: 'Nimbus', employmentType: 'Full Time',
      minSalary: 50000, maxSalary: 80000, currency: 'USD', seniority: ['Mid-level'],
      locationRestrictions: ['Nigeria', 'Kenya'], timezoneRestrictions: [0, 1, 3],
      categories: ['Software Engineering'], description: '<p>Build UI in React.</p>',
      pubDate: 1794304800, expiryDate: 1796896800,
      applicationLink: 'https://himalayas.app/companies/nimbus/jobs/frontend-engineer/apply',
      guid: 'https://himalayas.app/companies/nimbus/jobs/frontend-engineer',
    }],
  }],
  ['jobicy.com/api/v2/remote-jobs', {
    apiVersion: '2', jobCount: 1,
    jobs: [{
      id: 99001, url: 'https://jobicy.com/jobs/99001-seo-specialist', jobTitle: 'SEO Specialist', companyName: 'Rankly',
      jobIndustry: ['Marketing'], jobType: ['full-time'], jobGeo: 'Anywhere', jobLevel: 'Any',
      jobExcerpt: 'Grow organic traffic', jobDescription: '<p>Grow organic traffic.</p>', pubDate: '2026-11-12 08:30:00',
      annualSalaryMin: '30000', annualSalaryMax: '45000', salaryCurrency: 'USD',
    }],
  }],
  ['remoteok.com/api', [
    { last_updated: 1794441600, legal: 'API Terms of Service: credit Remote OK and link back.' },
    {
      slug: 'remote-devops-engineer-cloudy-1100', id: '1100', epoch: 1794384000, date: '2026-11-11T08:00:00+00:00',
      company: 'Cloudy', position: 'DevOps Engineer', tags: ['devops', 'aws', 'kubernetes'],
      description: '<p>Run our clusters.</p>', location: 'Worldwide', salary_min: 70000, salary_max: 100000,
      url: 'https://remoteOK.com/remote-jobs/remote-devops-engineer-cloudy-1100', apply_url: 'https://remoteOK.com/l/1100',
    },
  ]],
  ['remotive.com/api/remote-jobs', {
    '0-legal-notice': 'Remotive API Legal Notice', 'job-count': 1,
    jobs: [{
      id: 2001, url: 'https://remotive.com/remote-jobs/customer-support/support-hero-2001', title: 'Support Hero',
      company_name: 'Helpful', category: 'Customer Service', tags: ['zendesk'], job_type: 'full_time',
      publication_date: '2026-11-12T08:50:16', candidate_required_location: 'Africa, Europe',
      salary: '$1,500 - $2,000 per month', description: '<p>Answer tickets by email and chat for our customers worldwide.</p>',
    }],
  }],
  ['weworkremotely.com/remote-jobs.rss', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>WWR</title>
<item>
  <title>Pixel Co: Senior UI Designer</title>
  <region>Anywhere in the World</region>
  <country></country>
  <type>Full-Time</type>
  <description><![CDATA[<p>Design things.</p>]]></description>
  <pubDate>Tue, 10 Nov 2026 12:00:00 +0000</pubDate>
  <guid>https://weworkremotely.com/remote-jobs/pixel-co-senior-ui-designer</guid>
  <link>https://weworkremotely.com/remote-jobs/pixel-co-senior-ui-designer</link>
  <category>Design</category>
</item>
</channel></rss>`],
  ['workingnomads.com/api/exposed_jobs', [{
    url: 'https://www.workingnomads.com/jobs/data-analyst-numbers', title: 'Data Analyst', description: '<p>SQL and Python.</p>',
    company_name: 'Numbers', category_name: 'Data', tags: 'sql,python', location: 'Europe', pub_date: '2026-11-11T07:00:00Z',
  }]],
  ['getonbrd.com/api/v0/categories/programming/jobs', {
    data: [
      { id: 'ruby-dev-acme', type: 'job', attributes: { title: 'Ruby Developer', description: '<p>Rails app.</p>', remote: true, remote_modality: 'fully_remote', remote_zone: 'Worldwide', countries: [], min_salary: 3000, max_salary: 4000, published_at: 1794218400, category_name: 'Programming', company: { data: { attributes: { name: 'Acme LatAm' } } } }, links: { public_url: 'https://www.getonbrd.com/jobs/programming/ruby-dev-acme' } },
      { id: 'local-only', type: 'job', attributes: { title: 'Local Dev', remote: true, remote_modality: 'remote_local', countries: ['Chile'] }, links: { public_url: 'https://www.getonbrd.com/jobs/x' } },
    ],
  }],

  // ---------------------------------------------------------------- aggregators
  ['api.adzuna.com/v1/api/jobs/gb/search/1', {
    count: 1, results: [{
      id: '4567890123', title: '<strong>Remote</strong> Python Developer', description: 'Join our remote team building APIs for retailers across the UK…',
      redirect_url: 'https://www.adzuna.co.uk/jobs/land/ad/4567890123', created: '2026-11-11T10:00:00Z',
      company: { display_name: 'Snake Ltd' }, location: { display_name: 'London, UK', area: ['UK', 'London'] },
      salary_min: 55000, salary_max: 65000, salary_is_predicted: '0', contract_time: 'full_time', category: { label: 'IT Jobs', tag: 'it-jobs' },
    }],
  }],
  ['public.api.careerjet.net/search', {
    type: 'JOBS', hits: 1, pages: 1,
    jobs: [{ title: 'Accountant', company: 'Ledger Partners', date: 'Tue, 10 Nov 2026 07:43:23 GMT', description: 'Prepare monthly accounts.', locations: 'Lagos', salary: '₦350,000 per month', site: 'www.jobberman.com', url: 'https://jobviewtrack.com/v/abc' }],
  }],
  ['jooble.org/api/', {
    totalCount: 1,
    jobs: [{ title: 'Remote Copywriter', location: 'Remote', snippet: 'Write ads &nbsp;for &amp; with brands.', salary: '', source: 'example.com', type: 'Full-time', link: 'https://jooble.org/desc/1234567', company: 'Wordsmith', updated: '2026-11-11T00:00:00.0000000', id: 1234567 }],
  }],
  ['api.reliefweb.int/v2/jobs', {
    count: 1, data: [{
      id: '4100001', fields: {
        title: 'Programme Officer - Nutrition', 'body-html': '<p>Lead nutrition programmes in Borno.</p>', 'how_to_apply-html': '<p>Apply via our site.</p>',
        url_alias: 'https://reliefweb.int/job/4100001/programme-officer-nutrition',
        date: { created: '2026-11-09T00:00:00+00:00', closing: '2026-11-30T00:00:00+00:00' },
        source: [{ name: 'Helping Hands International', shortname: 'HHI', homepage: 'https://www.hhi.example.org' }],
        country: [{ name: 'Nigeria', iso3: 'nga' }], city: [{ name: 'Maiduguri' }], type: [{ name: 'Job' }],
        experience: [{ name: '3-4 years' }], career_categories: [{ name: 'Program/Project Management' }],
      },
    }],
  }],
  ['api.theirstack.com/v1/jobs/search', {
    metadata: {}, data: [
      { id: 900001, job_title: 'QA Engineer', url: 'https://boards.example.com/qa', final_url: 'https://careers.qa.example/qa', source_url: 'https://boards.example.com', date_posted: '2026-11-11', company: 'QAco', company_object: { name: 'QAco', domain: 'qa.example' }, location: 'Remote', country_code: 'US', remote: true, hybrid: false, min_annual_salary_usd: 60000, max_annual_salary_usd: 80000, employment_statuses: ['full_time'], description: 'Test all the things: write end-to-end tests and keep releases safe.', technology_slugs: ['cypress'] },
      { id: 900002, job_title: 'From LinkedIn', url: 'https://www.linkedin.com/jobs/view/1', final_url: null, source_url: 'https://www.linkedin.com', date_posted: '2026-11-11', company: 'Linky', remote: true, description: 'x' },
    ],
  }],

  // ---------------------------------------------------------------- social
  ['app.bsky.feed.searchPosts', {
    posts: [
      { uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'c1', author: { did: 'did:plc:abc', handle: 'acme.bsky.social', displayName: 'Acme' }, indexedAt: '2026-11-12T10:00:00Z', record: { text: "We're hiring a remote React developer! Apply: https://acme.example/careers/react", createdAt: '2026-11-12T10:00:00Z', facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://acme.example/careers/react' }] }] } },
      { uri: 'at://did:plc:def/app.bsky.feed.post/3kabc', cid: 'c2', author: { did: 'did:plc:def', handle: 'someone.bsky.social' }, record: { text: 'Lovely weather today #remotejobs', createdAt: '2026-11-12T11:00:00Z' } },
    ],
  }],
  ['hn.algolia.com/api/v1/search_by_date', { hits: [{ objectID: '45000000', title: 'Ask HN: Who is hiring? (November 2026)', created_at_i: 1793545200 }] }],
  ['hn.algolia.com/api/v1/items/45000000', {
    id: 45000000, children: [
      { id: 45000001, author: 'founder1', created_at: '2026-11-01T16:00:00.000Z', text: '<p>Paystackish | Backend Engineer | REMOTE (Africa) | Full-time<p>We build payments. Email jobs@paystackish.example', children: [] },
      { id: 45000002, author: 'founder2', created_at: '2026-11-01T16:05:00.000Z', text: '<p>Bigcorp | SRE | Onsite San Francisco<p>Apply at https://bigcorp.example/jobs', children: [] },
    ],
  }],
];

export function fakeFetch(calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = FIXTURES.find(([frag]) => url.includes(frag));
    if (!hit) return new Response('not found', { status: 404 });
    const body = typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]);
    return new Response(body, { status: 200, headers: { 'content-type': typeof hit[1] === 'string' ? 'application/xml' : 'application/json' } });
  }) as typeof fetch;
}
