import 'server-only';

/** Server-side settings, read when used (not at build time). Nothing here reaches the browser. */
function required(name: string, devFallback: string) {
  const v = process.env[name] ?? (process.env.NODE_ENV === 'production' ? undefined : devFallback);
  if (!v) throw new Error(`${name} is not set`);
  return v.replace(/\/+$/, '');
}

export const env = {
  get ENGINE_URL() { return required('ENGINE_URL', 'http://localhost:3000'); },
  get PUBLIC_APP_URL() { return required('PUBLIC_APP_URL', 'http://localhost:3001'); },
  get LANDING_SAMPLE_JOBS() { return process.env.NODE_ENV !== 'production' && process.env.LANDING_SAMPLE_JOBS !== 'false'; },
  get secureCookies() { return process.env.NODE_ENV === 'production'; },
};
