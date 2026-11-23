import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(true),
    CORS_ORIGINS: z.string().default('http://localhost:3001'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_ADMIN_URL: z.string().optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    MIGRATIONS_DIR: z.string().optional(),
    SEEDS_DIR: z.string().optional(),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    AUTH_PEPPER: z.string().min(32, 'AUTH_PEPPER must be at least 32 characters'),
    ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),

    IJOBS_SITE_SLUG: z.string().default('ijobs'),
    PUBLIC_APP_URL: z.string().default('http://localhost:3001'),

    MAIL_DRIVER: z.enum(['ses', 'console']).default('console'),
    MAIL_FROM_ACCOUNT: z.string().default('i-jobs <no-reply@mail.ijobs.example>'),
    SES_CONFIGURATION_SET_ACCOUNT: z.string().optional(),
    AWS_REGION: z.string().default('eu-west-1'),

    SMS_DRIVER: z.enum(['none', 'termii', 'console']).default('console'),
    TERMII_API_KEY: z.string().optional(),
    TERMII_SENDER_ID: z.string().optional(),
    TERMII_BASE_URL: z.string().default('https://api.ng.termii.com'),

    // AI: Groq free tier. Without a key, AI work waits (never fails) and code-only paths still run.
    GROQ_API_KEY: z.string().optional(),
    GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

    // Embeddings: Voyage. Without a key, matching uses skills and titles only.
    VOYAGE_API_KEY: z.string().optional(),
    VOYAGE_BASE_URL: z.string().default('https://api.voyageai.com/v1'),
    VOYAGE_MODEL: z.string().default('voyage-4'),
    /** Voyage's limits without a payment method are 3 requests and 10K tokens a minute. Raise after adding one. */
    VOYAGE_RPM: z.coerce.number().int().positive().default(3),
    VOYAGE_TPM: z.coerce.number().int().positive().default(10000),

    // File storage: Cloudflare R2 (S3 API). "memory" is for tests and local runs only.
    STORAGE_DRIVER: z.enum(['r2', 'memory', 'local']).default('memory'),
    /** Folder for STORAGE_DRIVER=local (development: shared by the API and the worker). */
    STORAGE_DIR: z.string().default('.storage'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().default('ijobs-files'),
    PDFTOTEXT_PATH: z.string().default('pdftotext'),

    // Applying. Autopilot sends from relay addresses on its own domain and configuration set.
    SES_CONFIGURATION_SET_RELAY: z.string().default('ijobs-relay'),
    /** Hours a member has to cancel an autopilot application before it goes. */
    AUTOPILOT_CANCEL_HOURS: z.coerce.number().int().min(0).max(48).default(2),
    /** Applications one employer (email domain) gets from all our members in a day. */
    EMPLOYER_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
    /** Shared secret for the Cloudflare email worker's posts to /hooks/inbound-email. */
    INBOUND_EMAIL_SECRET: z.string().min(32).optional(),
    /** SNS topics allowed to post to /hooks/ses (comma separated ARNs). Empty allows any verified topic. */
    SES_SNS_TOPIC_ARNS: z.string().default(''),
    /** Skip the SNS signature check on /hooks/ses. Tests only. */
    SES_SNS_SKIP_VERIFY: bool.default(false),

    // Communities and money. Prices are set by owners; these are i-jobs' own rules.
    PUBLIC_API_URL: z.string().default('http://localhost:3000'),
    /** i-jobs' share of each membership payment, in basis points (2000 = 20%). New communities only. */
    PLATFORM_SHARE_BPS: z.coerce.number().int().min(0).max(10000).default(2000),
    MINIMUM_PRICE_KOBO: z.coerce.number().int().positive().default(500000),
    TRIAL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    /** Days a member keeps access after a missed renewal. */
    GRACE_DAYS: z.coerce.number().int().min(0).max(14).default(3),
    /** Money is paid out only once it's this old (chargebacks), and only above the minimum. */
    PAYOUT_HOLD_DAYS: z.coerce.number().int().min(0).max(60).default(7),
    PAYOUT_MINIMUM_KOBO: z.coerce.number().int().positive().default(500000),
    PAGA_DRIVER: z.enum(['paga', 'fake']).default('fake'),
    PAGA_BASE_URL: z.string().default('https://beta-collect.paga.com'),
    PAGA_PUBLIC_KEY: z.string().optional(),
    PAGA_SECRET_KEY: z.string().optional(),
    PAGA_HASH_KEY: z.string().optional(),
    PAGA_PAYEE_NAME: z.string().default('i-jobs by 99'),

    // Encrypts stored secrets (ATS keys, webhook secrets). At least 32 characters; never change it
    // without re-encrypting, or stored keys stop working.
    SECRETS_KEY: z.string().min(32).default('dev-only-secrets-key-change-me-0123456789'),

    // Job ingest.
    INGEST_ENABLED: bool.default(true),
    /** Countries whose on-site and hybrid jobs we keep (ISO 3166-1 alpha-2). Remote jobs are always kept. */
    INGEST_ONSITE_COUNTRIES: z.string().default('NG'),
    /** Sent with every fetch so sources can reach us. */
    INGEST_USER_AGENT: z.string().default('ijobs-bot/1.0 (+https://ijobs.example/bot; jobs@ijobs.example)'),
    INGEST_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    LINK_CHECKS_PER_RUN: z.coerce.number().int().min(0).default(200),

    // Source credentials. A source whose credentials are missing is skipped, not failed.
    ADZUNA_APP_ID: z.string().optional(),
    ADZUNA_APP_KEY: z.string().optional(),
    JOOBLE_API_KEY: z.string().optional(),
    CAREERJET_AFFID: z.string().optional(),
    CAREERJET_API_KEY: z.string().optional(),
    RELIEFWEB_APPNAME: z.string().optional(),
    THEIRSTACK_API_KEY: z.string().optional(),
    BLUESKY_HANDLE: z.string().optional(),
    BLUESKY_APP_PASSWORD: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    if (c.MAIL_DRIVER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['MAIL_DRIVER'], message: 'must be "ses" in production' });
    }
    if (c.SMS_DRIVER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['SMS_DRIVER'], message: 'must be "termii", or "none" to run email-only, in production' });
    }
    if (!c.INBOUND_EMAIL_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['INBOUND_EMAIL_SECRET'], message: 'is required in production (at least 32 characters)' });
    }
    if (c.SES_SNS_SKIP_VERIFY) {
      ctx.addIssue({ code: 'custom', path: ['SES_SNS_SKIP_VERIFY'], message: 'must be false in production' });
    }
    if (c.SECRETS_KEY.startsWith('dev-only')) {
      ctx.addIssue({ code: 'custom', path: ['SECRETS_KEY'], message: 'set a real secret in production' });
    }
    if (c.PAGA_DRIVER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PAGA_DRIVER'], message: 'must be "paga" in production' });
    }
    if (c.PAGA_DRIVER === 'paga' && (!c.PAGA_PUBLIC_KEY || !c.PAGA_SECRET_KEY || !c.PAGA_HASH_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['PAGA_PUBLIC_KEY'], message: 'PAGA_PUBLIC_KEY, PAGA_SECRET_KEY and PAGA_HASH_KEY are required' });
    }
    if (c.STORAGE_DRIVER === 'memory') {
      ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'must be "r2" in production' });
    }
    if (c.STORAGE_DRIVER === 'r2' && (!c.R2_ACCOUNT_ID || !c.R2_ACCESS_KEY_ID || !c.R2_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['R2_ACCOUNT_ID'], message: 'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required' });
    }
    if (c.SMS_DRIVER === 'termii' && (!c.TERMII_API_KEY || !c.TERMII_SENDER_ID)) {
      ctx.addIssue({ code: 'custom', path: ['TERMII_API_KEY'], message: 'TERMII_API_KEY and TERMII_SENDER_ID are required' });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export const CONFIG = Symbol('CONFIG');

/** Reads and checks environment variables once at start-up. Fails fast with a readable list. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Configuration is invalid:\n${lines.join('\n')}`);
  }
  return result.data;
}
