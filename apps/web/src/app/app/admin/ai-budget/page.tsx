import { engine, must } from '@/lib/engine';
import { dateLabel } from '@/lib/format';
import u from '../../_ui/ui.module.css';
import { needs } from '../_parts/staff';

const TASK: Record<string, string> = {
  job_extract: 'Reading pasted jobs', scam_check: 'Scam checks', cv_parse: 'Reading CVs', app_paragraph: 'Application notes',
  reply_sort: 'Sorting employer replies', apply_pack: 'Apply packs', support_answer: 'Help answers',
};

export default async function AiBudget() {
  await needs('/app/admin/ai-budget');
  const b = must(await (await engine()).GET('/admin/ai-budget'));
  const waiting = b.waiting ?? {};
  return (
    <>
      <p className={u.muted}>Today’s token allowance per task (UTC day {b.day}). It resets {dateLabel(b.resets_at, true)} Lagos time. Work that doesn’t fit waits for tomorrow.</p>
      <div className={u.tableWrap}>
        <table className={u.table}>
          <thead><tr><th>Task</th><th>Model</th><th style={{ minWidth: 180 }}>Used today</th><th>Left</th><th>About this many calls left</th><th>Waiting</th></tr></thead>
          <tbody>
            {(b.tasks ?? []).map((t) => {
              const pct = t.daily_tokens ? Math.min(100, Math.round(((t.spent_tokens ?? 0) / t.daily_tokens) * 100)) : 0;
              return (
                <tr key={t.task}>
                  <td><b>{TASK[t.task ?? ''] ?? t.task}</b></td>
                  <td className={u.muted}>{t.model}</td>
                  <td><div className={u.bar} title={`${pct}%`}><i style={{ width: `${pct}%`, background: pct > 90 ? 'var(--tag-red)' : undefined }} /></div><span className={u.muted}>{(t.spent_tokens ?? 0).toLocaleString('en-NG')} of {(t.daily_tokens ?? 0).toLocaleString('en-NG')}</span></td>
                  <td className={u.num}>{(t.remaining_tokens ?? 0).toLocaleString('en-NG')}</td>
                  <td className={u.num}>{(t.calls_left_estimate ?? 0).toLocaleString('en-NG')}</td>
                  <td className={u.num}>{waiting[t.task ?? ''] ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={u.help}>Allowances live in the <code>ai_task_budgets</code> table (daily_tokens per task).</p>
    </>
  );
}
