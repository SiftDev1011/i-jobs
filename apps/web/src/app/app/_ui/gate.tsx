import Link from 'next/link';
import { EngineError } from '@/lib/engine';
import u from './ui.module.css';

/** What to show when the engine says job features aren't open to this person yet. */
export function Gate({ error }: { error: EngineError }) {
  const msg =
    error.code === 'age_restricted' ? 'Job features open once a parent approves your account. You can ask them from your home page.'
    : error.code === 'consent_required' ? `${error.message}. You can do that in Settings.`
    : 'Join a community, or renew your membership, to see matches and applications.';
  return (
    <div className={u.empty}>
      <p>{msg}</p>
      <div className={u.row}>
        <Link className="btn btn-green btn-sm" href="/app">Go to your home page</Link>
        {error.code === 'consent_required' && <Link className="btn btn-line btn-sm" href="/app/settings">Settings</Link>}
      </div>
    </div>
  );
}

/** Runs an engine call; a 403 becomes a Gate instead of an error page. */
export async function gated<T>(fn: () => Promise<T>): Promise<{ data: T; gate: null } | { data: null; gate: EngineError }> {
  try {
    return { data: await fn(), gate: null };
  } catch (e) {
    if (e instanceof EngineError && e.status === 403) return { data: null, gate: e };
    throw e;
  }
}
