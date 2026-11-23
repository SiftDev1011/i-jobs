import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { SourceForm } from '../_parts/source-form';
import { needs } from '../_parts/staff';

export default async function Sources() {
  const role = await needs('/app/admin/sources');
  const sources = must(await (await engine()).GET('/admin/sources'));
  return (
    <>
      <p className={u.muted}>Where jobs come from and what each source allows. {role === 'admin' ? 'Changes are logged.' : 'Only admins can change these.'}</p>
      <ul className={u.list}>
        {sources.map((s) => {
          const h = s.health ?? {};
          const tone = !s.enabled ? u.gray : h.last_run_ok === false || (h.failures_in_a_row ?? 0) > 0 ? u.bad : u.good;
          return (
            <li key={s.key}>
              <details className={u.card}>
                <summary style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span><b>{s.name}</b> <span className={u.muted}>· {s.kind} · {s.key}</span></span>
                  <span className={u.row} style={{ gap: 8 }}>
                    <span className={u.muted}>{h.jobs_live ?? 0} live · last run {h.last_run_at ? dateLabel(h.last_run_at, true) : 'never'}</span>
                    <span className={`${u.chip} ${tone}`}>{!s.enabled ? 'Off' : (h.failures_in_a_row ?? 0) > 0 ? `${h.failures_in_a_row} failures` : 'OK'}</span>
                  </span>
                </summary>
                {s.terms_url && <p className={u.small}><a href={s.terms_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--action-ink)' }}>Their terms</a></p>}
                <SourceForm s={s} canEdit={role === 'admin'} />
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
